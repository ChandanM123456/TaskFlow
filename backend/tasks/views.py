from rest_framework import viewsets, status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework.exceptions import PermissionDenied, NotFound, ValidationError

from django.contrib.auth import get_user_model
from django.db.models import Count
from django.shortcuts import get_object_or_404
from datetime import datetime
import subprocess
import os 

# Import your models and serializers
from .models import Task, UserProfile, Meeting 
from .serializers import (
    TaskSerializer,
    UserSerializer,
    CustomTokenObtainPairSerializer,
    MeetingSerializer
)
from .permissions import IsScrumMasterOrOwner

User = get_user_model()

# --- Helper Function for Role Check ---
def is_scrum_master(user):
    """Checks if the user's profile role is 'SCRUM_MASTER'."""
    # Note: Assumes the User model has a one-to-one or foreign key relation to UserProfile.
    # It safely defaults to 'EMPLOYEE' if the profile or role attribute is missing.
    return getattr(user.profile, 'role', 'EMPLOYEE') == 'SCRUM_MASTER'

# ------------------------------------------------
# Task ViewSet
# ------------------------------------------------
class TaskViewSet(viewsets.ModelViewSet):
    """
    CRUD for Tasks.
    Scrum Master can view/manage all tasks.
    Employee can view/manage only tasks assigned to them.
    Permission: IsAuthenticated & IsScrumMasterOrOwner.
    """
    serializer_class = TaskSerializer
    permission_classes = [IsAuthenticated, IsScrumMasterOrOwner]
    
    def get_queryset(self):
        user = self.request.user
        if is_scrum_master(user):
            return Task.objects.all().select_related('assigned_to').order_by('-created_at')
        # Employees only see their own tasks
        return Task.objects.filter(assigned_to=user).order_by('-created_at')

    def perform_create(self, serializer):
        """
        Set assigned_to automatically to the creating user if they are an EMPLOYEE.
        Scrum Master must explicitly set `assigned_to` in the request data.
        """
        user = self.request.user
        if is_scrum_master(user):
            # Scrum Master is expected to provide `assigned_to` ID in data
            serializer.save()
        else:
            # Employee creating a task assigns it to themselves
            serializer.save(assigned_to=user)

    @action(detail=False, methods=['get'])
    def employees(self, request):
        """
        Lists all employees and their current task count.
        Only accessible by Scrum Masters.
        Route: /tasks/employees/
        """
        if not is_scrum_master(request.user):
            # Use DRF exception for proper status code and response format
            raise PermissionDenied(detail="Only Scrum Masters can view employee task counts.")
            
        employees = (
            User.objects
            .filter(profile__role='EMPLOYEE')
            .annotate(task_count=Count('tasks'))
            .order_by('username')
        )
        data = [
            {"id": emp.id, "username": emp.username, "tasks": emp.task_count}
            for emp in employees
        ]
        return Response(data)

# ------------------------------------------------
# Employee CRUD (Scrum Master only)
# ------------------------------------------------
class EmployeeViewSet(viewsets.ModelViewSet):
    """
    CRUD operations for Employee users. Only accessible by Scrum Masters.
    """
    # Base queryset for listing and retrieving employees
    queryset = User.objects.filter(profile__role="EMPLOYEE").select_related('profile').order_by('username')
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'put', 'patch', 'delete', 'head', 'options'] 

    def check_permissions(self, request):
        """Custom permission check for Scrum Master role."""
        super().check_permissions(request)
        if not is_scrum_master(request.user):
            raise PermissionDenied(detail="Only Scrum Masters can manage employees.")

    def update(self, request, *args, **kwargs):
        """Allows Scrum Master to update only the employee's username."""
        instance = self.get_object()
        
        # Only allow username update for simplicity, disallow other changes (e.g., role, password)
        data = request.data.copy()
        new_username = data.get("username", "").strip()
        
        if not new_username:
             return Response({"error": "Username required"}, status=status.HTTP_400_BAD_REQUEST)
        
        # Check if the username is taken by another employee
        if User.objects.filter(username__iexact=new_username).exclude(pk=instance.pk).exists():
             return Response({"error": f"Username '{new_username}' already exists"}, 
                             status=status.HTTP_400_BAD_REQUEST)
        
        # Manually update the username field and save
        instance.username = new_username
        instance.save(update_fields=['username'])

        # Return a clean response or serialized data
        return Response(self.get_serializer(instance).data)

    def destroy(self, request, *args, **kwargs):
        """Deletes the employee user."""
        instance = self.get_object()
        self.perform_destroy(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)

# ------------------------------------------------
# Code Execution View
# ------------------------------------------------
class CodeExecutionView(APIView):
    """
    Endpoint for executing Python code. 
    WARNING: Running arbitrary code is inherently insecure. This code is for illustration 
    and should not be used in production without extreme sandboxing.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        code = request.data.get('code', '').strip()
        language = request.data.get('language', '').strip().lower()
        task_id = request.data.get('task_id')
        success_condition = request.data.get('success_condition', '').strip()

        if not code or language != "python":
            return Response({"error": "Code is required, and only 'python' is currently supported."}, 
                            status=status.HTTP_400_BAD_REQUEST)

        output, error = "", ""
        
        try:
            # Security measure: attempt to drop privileges (highly unreliable without proper system setup)
            preexec_fn = None
            if hasattr(os, 'setuid') and os.getuid() == 0:
                # Basic attempt to run as an unprivileged user (e.g., ID 1000)
                preexec_fn = lambda: os.setuid(1000) 
                
            proc = subprocess.run(
                ['python', '-c', code],
                capture_output=True,
                text=True,
                timeout=10, 
                check=False, 
                preexec_fn=preexec_fn 
            )
            output, error = proc.stdout, proc.stderr
            if proc.returncode != 0 and not error:
                error = f"Code exited with non-zero status code: {proc.returncode}"
                
        except subprocess.TimeoutExpired:
            error = "Execution timed out (exceeded 10 seconds)."
        except Exception as e:
            error = f"Execution error: {str(e)}"

        task_updated = False
        if task_id and success_condition and not error and success_condition in output:
            try:
                # Employee can only mark their own tasks as DONE
                task = get_object_or_404(Task, id=task_id, assigned_to=request.user)
                task.status = 'DONE'
                task.save(update_fields=['status'])
                task_updated = True
            except NotFound:
                error += "\nTask not found or you are not the assigned user."

        if not error and not output:
             output = "Code executed, but produced no output."

        return Response({
            "output": output,
            "error": error,
            "task_updated": task_updated
        }, status=status.HTTP_200_OK)

# ------------------------------------------------
# User Registration Views (Simplified and Combined Logic)
# ------------------------------------------------

class RegisterView(APIView):
    """Base view for user registration with common validation logic."""
    permission_classes = [AllowAny]
    
    def _validate_input(self, data):
        username = data.get("username", "").strip()
        password = data.get("password", "").strip()
        if not username or not password:
            raise ValidationError({"error": "Username and password required"})
        
        if User.objects.filter(username__iexact=username).exists():
            raise ValidationError({"error": f"Username '{username}' already exists"})
        
        return username, password
        
    def _create_user_and_profile(self, username, password, role):
        user = User.objects.create_user(username=username, password=password)
        profile, _ = UserProfile.objects.get_or_create(user=user)
        profile.role = role
        profile.save()
        return user, profile

    def _generate_response(self, user, profile, message):
        refresh = RefreshToken.for_user(user)
        return Response({
            "message": message,
            "username": user.username,
            "role": profile.role,
            "access": str(refresh.access_token),
            "refresh": str(refresh)
        }, status=status.HTTP_201_CREATED)

class EmployeeRegisterView(RegisterView):
    """Handles new EMPLOYEE registration."""
    def post(self, request):
        username, password = self._validate_input(request.data)
        user, profile = self._create_user_and_profile(username, password, "EMPLOYEE")
        return self._generate_response(user, profile, "Employee registered successfully")

class ScrumMasterRegisterView(RegisterView):
    """Handles SCRUM_MASTER registration (only one allowed)."""
    def post(self, request):
        if UserProfile.objects.filter(role="SCRUM_MASTER").exists():
            return Response({"error": "A Scrum Master already exists"}, 
                            status=status.HTTP_400_BAD_REQUEST)
                            
        username, password = self._validate_input(request.data)
        user, profile = self._create_user_and_profile(username, password, "SCRUM_MASTER")
        return self._generate_response(user, profile, "Scrum Master registered successfully")

# ------------------------------------------------
# Custom JWT Login
# ------------------------------------------------
class CustomTokenObtainPairView(TokenObtainPairView):
    """Uses a custom serializer to return more user info on login."""
    serializer_class = CustomTokenObtainPairSerializer

# ------------------------------------------------
# Meeting ViewSet
# ------------------------------------------------
class MeetingViewSet(viewsets.ModelViewSet):
    """
    CRUD for Meetings. Only Scrum Masters can create/update/delete. All authenticated 
    users can list/retrieve.
    """
    serializer_class = MeetingSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # Optimized to order by the scheduled time
        return Meeting.objects.all().order_by('-time')

    def check_permissions(self, request):
        """Only Scrum Masters can create/update/delete meetings."""
        super().check_permissions(request)
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            if not is_scrum_master(request.user):
                raise PermissionDenied(detail="Only Scrum Masters can schedule/manage meetings.")

    def create(self, request, *args, **kwargs):
        """Custom create method to handle date parsing logic and validation."""
        
        data = request.data.copy()
        time_raw = data.get("time", "").strip()

        # Helper to parse common datetime formats not standardly accepted by DRF
        def parse_datetime(dt_str):
            if not dt_str:
                return None
            for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%m/%d/%Y %I:%M %p"):
                try:
                    return datetime.strptime(dt_str, fmt)
                except Exception:
                    continue
            return None 
        
        if time_raw:
             parsed_time = parse_datetime(time_raw)
             if parsed_time:
                 # Convert the successfully parsed time to a standard ISO format
                 data['time'] = parsed_time.isoformat() 

        serializer = self.get_serializer(data=data)
        try:
            # Raise exception on validation failure for DRF to handle
            serializer.is_valid(raise_exception=True)
            self.perform_create(serializer)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except Exception as e:
            # Catch any remaining exception during serialization or database save
            print("Meeting creation error:", e)
            # Re-raise as a generic ValidationError for a clean API response
            raise ValidationError(detail={"general": "Could not schedule meeting.", "details": str(e)})