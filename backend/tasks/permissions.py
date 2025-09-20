from rest_framework import permissions

class IsScrumMasterOrOwner(permissions.BasePermission):
    """
    Custom permission:
    - Scrum Masters can view, create, edit, and delete all tasks.
    - Employees can only view and edit tasks assigned to them.
    - Superusers have full access.
    """

    def has_object_permission(self, request, view, obj):
        # Superusers have unrestricted access
        if request.user.is_superuser:
            return True

        # Get the role of the user
        role = getattr(request.user.profile, 'role', None)

        # Scrum Master has full access
        if role == 'SCRUM_MASTER':
            return True

        # Employee can only manage their own tasks
        if role == 'EMPLOYEE':
            return obj.assigned_to == request.user

        # Default deny
        return False
