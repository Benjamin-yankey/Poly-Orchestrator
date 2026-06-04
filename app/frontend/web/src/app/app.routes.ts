import { Routes } from '@angular/router';
import { authGuard, employeeGuard, managementGuard } from './core/guards';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'product/:id',
    loadComponent: () =>
      import('./pages/product-detail.component').then((m) => m.ProductDetailComponent),
  },
  {
    path: 'marketplace',
    loadComponent: () =>
      import('./pages/marketplace.component').then((m) => m.MarketplaceComponent),
  },
  {
    path: 'sell',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/sell.component').then((m) => m.SellComponent),
  },
  {
    path: 'cart',
    loadComponent: () => import('./pages/cart.component').then((m) => m.CartComponent),
  },
  {
    path: 'wishlist',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/wishlist.component').then((m) => m.WishlistComponent),
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: 'checkout',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/checkout.component').then((m) => m.CheckoutComponent),
  },
  {
    path: 'orders',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/orders.component').then((m) => m.OrdersComponent),
  },
  {
    path: 'profile',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/profile.component').then((m) => m.ProfileComponent),
  },
  {
    path: 'support',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/support.component').then((m) => m.SupportComponent),
  },
  {
    path: 'notifications',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/notifications.component').then((m) => m.NotificationsComponent),
  },
  {
    path: 'addresses',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/addresses.component').then((m) => m.AddressesComponent),
  },
  {
    path: 'payment-methods',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/payment-methods.component').then((m) => m.PaymentMethodsComponent),
  },
  {
    path: 'employee',
    canActivate: [authGuard, employeeGuard],
    loadComponent: () => import('./pages/employee.component').then((m) => m.EmployeeComponent),
  },
  {
    path: 'admin',
    canActivate: [authGuard, managementGuard],
    loadComponent: () => import('./pages/admin.component').then((m) => m.AdminComponent),
  },
  { path: '**', redirectTo: '' },
];
