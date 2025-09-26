from django.db import models
from django.contrib.auth.models import User
from django.conf import settings

# -------------------------------
# User Profile
# -------------------------------
class UserProfile(models.Model):
    ROLE_CHOICES = [
        ('SCRUM_MASTER', 'Scrum Master'),
        ('EMPLOYEE', 'Employee'),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='EMPLOYEE')

    def __str__(self):
        return f"{self.user.username} ({self.get_role_display()})"

# -------------------------------
# Task Model
# -------------------------------
class Task(models.Model):
    STATUS_CHOICES = [
        ('TODO', 'To Do'),
        ('IN_PROGRESS', 'In Progress'),
        ('REVIEW', 'Review'),
        ('DONE', 'Done'),
    ]

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    assigned_to = models.ForeignKey(User, on_delete=models.CASCADE, related_name="tasks")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='TODO')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deadline = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.title} → {self.status} (Assigned to: {self.assigned_to.username})"

# -------------------------------
# Meeting Model
# -------------------------------
class Meeting(models.Model):
    title = models.CharField(max_length=255)
    link = models.URLField()
    description = models.TextField(blank=True, null=True)
    time = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title
