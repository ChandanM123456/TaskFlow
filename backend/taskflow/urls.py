from django.contrib import admin
from django.urls import path, include
from tasks.views import CustomTokenObtainPairView
from rest_framework_simplejwt.views import TokenRefreshView
from .views import home

urlpatterns = [
    # Home route
    path('', home, name="home"),

    # Admin panel
    path('admin/', admin.site.urls),

    # App-specific API routes
    path('api/', include('tasks.urls')),

    # JWT Authentication
    path('api/auth/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
]
