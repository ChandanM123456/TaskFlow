from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    TaskViewSet,
    EmployeeViewSet,
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

# -------------------------------
# URL patterns
# -------------------------------
urlpatterns = [
    # Core API routes
    path('', include(router.urls)),

    # Authentication (JWT)
    path('auth/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),

    # Registration
    path('auth/register/employee/', EmployeeRegisterView.as_view(), name='employee_register'),
    path('auth/register/scrum-master/', ScrumMasterRegisterView.as_view(), name='scrum_master_register'),

    # Code execution endpoint
    path('code/execute/', CodeExecutionView.as_view(), name='code_execute'),
]
