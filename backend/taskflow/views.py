from django.http import HttpResponse

def home(request):
    return HttpResponse("<h1>Welcome to TaskFlow API 🚀</h1><p>Use /api/ for endpoints or /admin/ for admin panel.</p>")
