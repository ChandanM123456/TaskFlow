from rest_framework import viewsets, status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from django.contrib.auth import get_user_model
from django.db.models import Count
import subprocess

from .models import Task, UserProfile
from .serializers import TaskSerializer, UserSerializer, CustomTokenObtainPairSerializer
from .permissions import IsScrumMasterOrOwner

User = get_user_model()

# -------------------------------
# Task ViewSet
# -------------------------------
class TaskViewSet(viewsets.ModelViewSet):
    serializer_class = TaskSerializer
    permission_classes = [IsAuthenticated, IsScrumMasterOrOwner]

    def get_queryset(self):
        user = self.request.user
        role = getattr(user.profile, 'role', 'EMPLOYEE')
        if role == 'SCRUM_MASTER':
            return Task.objects.all().order_by('-created_at')
        return Task.objects.filter(assigned_to=user).order_by('-created_at')

    def perform_create(self, serializer):
        user = self.request.user
        role = getattr(user.profile, 'role', 'EMPLOYEE')
        if role == 'EMPLOYEE':
            serializer.save(assigned_to=user)
        else:
            serializer.save()

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def employees(self, request):
        user = request.user
        role = getattr(user.profile, 'role', 'EMPLOYEE')
        if role != 'SCRUM_MASTER':
            return Response({"detail": "Not authorized"}, status=status.HTTP_403_FORBIDDEN)
        employees = User.objects.filter(profile__role='EMPLOYEE').annotate(task_count=Count('tasks'))
        data = [
            {
                "id": emp.id,
                "username": emp.username,
                "tasks": emp.task_count
            }
            for emp in employees
        ]
        return Response(data)

# -------------------------------
# Employee CRUD (Scrum Master only)
# -------------------------------
class EmployeeViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request):
        if getattr(request.user.profile, 'role', '') != "SCRUM_MASTER":
            return Response({"detail": "Not authorized"}, status=status.HTTP_403_FORBIDDEN)
        employees = User.objects.filter(profile__role="EMPLOYEE")
        serializer = UserSerializer(employees, many=True)
        return Response(serializer.data)

    def update(self, request, pk=None):
        if getattr(request.user.profile, 'role', '') != "SCRUM_MASTER":
            return Response({"detail": "Not authorized"}, status=status.HTTP_403_FORBIDDEN)
        try:
            emp = User.objects.get(id=pk, profile__role="EMPLOYEE")
        except User.DoesNotExist:
            return Response({"detail": "Employee not found"}, status=status.HTTP_404_NOT_FOUND)
        new_username = request.data.get("username", "").strip()
        if not new_username:
            return Response({"error": "Username required"}, status=status.HTTP_400_BAD_REQUEST)
        emp.username = new_username
        emp.save()
        return Response({"message": "Employee updated", "id": emp.id, "username": emp.username})

    def destroy(self, request, pk=None):
        if getattr(request.user.profile, 'role', '') != "SCRUM_MASTER":
            return Response({"detail": "Not authorized"}, status=status.HTTP_403_FORBIDDEN)
        try:
            emp = User.objects.get(id=pk, profile__role="EMPLOYEE")
        except User.DoesNotExist:
            return Response({"detail": "Employee not found"}, status=status.HTTP_404_NOT_FOUND)
        emp.delete()
        return Response({"message": "Employee deleted"}, status=status.HTTP_204_NO_CONTENT)

# -------------------------------
# Code Execution View
# -------------------------------
class CodeExecutionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        code = request.data.get('code', '').strip()
        language = request.data.get('language', '').strip()
        task_id = request.data.get('task_id')
        success_condition = request.data.get('success_condition', '').strip()

        if not code or not language:
            return Response({"error": "Code and language are required"}, status=status.HTTP_400_BAD_REQUEST)

        output = ""
        error = ""

        if language == "python":
            try:
                process = subprocess.run(
                    ['python', '-c', code],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                output = process.stdout
                error = process.stderr
            except subprocess.TimeoutExpired:
                error = "Execution timed out."
            except Exception as e:
                error = str(e)

        task_updated = False
        if success_condition and not error and success_condition in output and task_id:
            try:
                task = Task.objects.get(id=task_id)
                task.status = 'DONE'
                task.save()
                task_updated = True
            except Task.DoesNotExist:
                error += "\nTask not found."

        if not error and not output:
            output = "Code executed, but produced no output."

        return Response({
            "output": output,
            "error": error,
            "task_updated": task_updated
        }, status=status.HTTP_200_OK)

# -------------------------------
# Employee Register
# -------------------------------
class EmployeeRegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = request.data.get("username", "").strip()
        password = request.data.get("password", "").strip()

        if not username or not password:
            return Response({"error": "Username and password required"}, status=status.HTTP_400_BAD_REQUEST)

        if User.objects.filter(username__iexact=username).exists():
            return Response({"error": f"Username '{username}' already exists"}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.create_user(username=username, password=password)
        profile, _ = UserProfile.objects.get_or_create(user=user)
        profile.role = "EMPLOYEE"
        profile.save()

        refresh = RefreshToken.for_user(user)
        return Response({
            "message": "Employee registered successfully",
            "username": user.username,
            "role": profile.role,
            "access": str(refresh.access_token),
            "refresh": str(refresh)
        }, status=status.HTTP_201_CREATED)

# -------------------------------
# Scrum Master Register
# -------------------------------
class ScrumMasterRegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = request.data.get("username", "").strip()
        password = request.data.get("password", "").strip()

        if not username or not password:
            return Response({"error": "Username and password required"}, status=status.HTTP_400_BAD_REQUEST)

        if UserProfile.objects.filter(role="SCRUM_MASTER").exists():
            return Response({"error": "A Scrum Master already exists"}, status=status.HTTP_400_BAD_REQUEST)

        if User.objects.filter(username__iexact=username).exists():
            return Response({"error": f"Username '{username}' already exists"}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.create_user(username=username, password=password)
        profile, _ = UserProfile.objects.get_or_create(user=user)
        profile.role = "SCRUM_MASTER"
        profile.save()

        refresh = RefreshToken.for_user(user)
        return Response({
            "message": "Scrum Master registered successfully",
            "username": user.username,
            "role": profile.role,
            "access": str(refresh.access_token),
            "refresh": str(refresh)
        }, status=status.HTTP_201_CREATED)

# -------------------------------
# Custom JWT Login
# -------------------------------
class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
