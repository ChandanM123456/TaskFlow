from rest_framework import serializers
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .models import Task, UserProfile

User = get_user_model()

# -------------------------------
# Task Serializer
# -------------------------------
class TaskSerializer(serializers.ModelSerializer):
    assigned_to_username = serializers.CharField(source='assigned_to.username', read_only=True)

    class Meta:
        model = Task
        fields = "__all__"


# -------------------------------
# User Serializer
# -------------------------------
class UserSerializer(serializers.ModelSerializer):
    tasks_count = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "tasks_count"]

    def get_tasks_count(self, obj):
        return Task.objects.filter(assigned_to=obj).count()


# -------------------------------
# Custom JWT Serializer
# -------------------------------
class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)

        # Safely fetch role from UserProfile
        try:
            profile = UserProfile.objects.get(user=self.user)
            role = profile.role
        except UserProfile.DoesNotExist:
            role = "EMPLOYEE"  # default fallback

        data.update({
            "username": self.user.username,
            "role": role
        })
        return data
