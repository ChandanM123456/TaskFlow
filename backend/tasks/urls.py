from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .views import (
    TaskViewSet,
    EmployeeViewSet,
    MeetingViewSet,
    CustomTokenObtainPairView,
    EmployeeRegisterView,
    ScrumMasterRegisterView,
    CodeExecutionView,
)

# -------------------------------
# Router setup for viewsets
# -------------------------------
router = DefaultRouter()
router.register(r'tasks', TaskViewSet, basename='task')
router.register(r'employees', EmployeeViewSet, basename='employee')
router.register(r'meetings', MeetingViewSet, basename='meeting')

# -------------------------------
# Dummy telemetry endpoint
# -------------------------------
@api_view(['POST'])
def batch_events(request):
    return Response({"message": "Telemetry received"}, status=200)

# -------------------------------
# URL patterns
# -------------------------------
urlpatterns = [
    # ViewSet routes
    path('', include(router.urls)),

    # JWT Authentication
    path('auth/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),

    # User registration
    path('auth/register/employee/', EmployeeRegisterView.as_view(), name='employee_register'),
    path('auth/register/scrum-master/', ScrumMasterRegisterView.as_view(), name='scrum_master_register'),

    # Code execution
    path('code/execute/', CodeExecutionView.as_view(), name='code_execute'),

    # Telemetry
    path('events/batch/', batch_events, name='batch_events'),
]
