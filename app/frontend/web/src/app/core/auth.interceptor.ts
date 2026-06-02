import { HttpInterceptorFn } from '@angular/common/http';

// Attach the stored JWT to every same-origin /api request so the backend
// services (which verify the shared-secret token) can identify the caller.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('shopnow_token');
  if (token && req.url.startsWith('/api')) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req);
};
