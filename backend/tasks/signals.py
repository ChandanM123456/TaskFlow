from django.db.models.signals import post_save
from django.contrib.auth.models import User
from django.dispatch import receiver
from .models import UserProfile

@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    """
    Automatically creates a UserProfile for every new User.
    Default role is 'EMPLOYEE'.
    """
    if created:
        UserProfile.objects.create(user=instance, role="EMPLOYEE")

@receiver(post_save, sender=User)
def save_user_profile(sender, instance, **kwargs):
    """
    Ensures that the UserProfile is saved whenever the User is saved.
    """
    if hasattr(instance, 'profile'):
        instance.profile.save()
