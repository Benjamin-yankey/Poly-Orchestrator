import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

// Require a logged-in user; otherwise bounce to /login with a return URL.
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isLoggedIn() || auth.token) return true;
  return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
};

// Require an admin user.
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAdmin()) return true;
  return router.createUrlTree(['/']);
};

// Allow the admin console for admins (full control) and the staffing team
// (read-only). Other roles are bounced home.
export const managementGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.canViewAdmin()) return true;
  return router.createUrlTree(['/']);
};
