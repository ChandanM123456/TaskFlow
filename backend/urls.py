from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import TaskViewSet, CustomTokenObtainPairView
from rest_framework_simplejwt.views import TokenRefreshView

# Router for TaskViewSet
router = DefaultRouter()
router.register(r'tasks', TaskViewSet, basename='task')

urlpatterns = [
    # Task CRUD endpoints
    path('', include(router.urls)),

    # JWT Authentication endpoints
    path('auth/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),

    # Employees list for Scrum Master
    path('employees/', TaskViewSet.as_view({'get': 'employees'}), name='employees-list'),
]
