// --- CORE IMPORTS ---
import React from 'react';
import { Routes, Route } from 'react-router-dom'; 

// --- CONTEXT IMPORTS ---
import { AuthProvider } from './components/AuthContext/AuthContext.jsx'; // Make sure this path is correct
import { InventoryProvider , useInventory } from './components/InventoryContext/InventoryProvider.jsx'; 
import { FinanceProvider } from './components/FinanceContext/FinanceProvider.jsx';
import { ThemeProvider } from './contexts/ThemeContext';

// --- COMPONENT IMPORTS (Your Original Files) ---
import AdminPage from './admin/admin.jsx';
import Header from './components/Header/Header.jsx';
import Sidebar from './components/Sidebar/Sidebar.jsx';
import WorkinProgress from './components/WorkinProgress/WorkinProgress.jsx';
import Homepage from './Homepage/Homepage.jsx';
import Order from './components/Order/order.jsx';
import TrackOrder from './components/TrackOrder/TrackOrder.jsx';
import CommerceHub from './components/CommerceHub/CommerceHub.jsx';
import Announcement from './components/Announcement.jsx';
import ClassUpload from './components/ClassUpload.jsx';
import DeathAid from './components/DeathAid.jsx';
import Login from './components/Login/Login.jsx'; 
import ProtectedRoute from './components/ProtectedRoute/ProtectedRoute.jsx';
import FinanceDashboard from './components/Finance/FinanceDashboard.jsx';
import InventoryManagement from './components/InventoryDashboard/InventoryManagement.jsx';
import PDFDashboard from './components/Document/PDFDahsboard.jsx';
import AccessDenied from './components/AccessDenied/AccessDenied.jsx';
import UserManagement from './components/UserManagement/UserManagement.jsx';
import AuditTrail from './components/AuditTrail/AuditTrail.jsx';
// --- STYLES ---
import './styles/themes.css';

import styles from './App.module.css';



const DashboardLayout = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = React.useState(
    window.innerWidth > 768 // Open by default on desktop
  );

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <div className={styles.app}>
      <Header sidebarOpen={sidebarOpen} toggleSidebar={toggleSidebar} />
      <div className={styles.mainContent}>
        <Sidebar isOpen={sidebarOpen} toggleSidebar={toggleSidebar} />
        <div className={`${styles.contentWrapper} ${!sidebarOpen ? styles.contentWrapperSidebarClosed : ''}`}>
          {React.cloneElement(children, { toggleSidebar, sidebarOpen })}
        </div>
      </div>
    </div>
  );
};

function App() {
  return (
    // NOTE: Removed <BrowserRouter> and <CardProvider> here as they are now in main.jsx
    <ThemeProvider>
      <AuthProvider> 
        <InventoryProvider> 
        <FinanceProvider>
        <Routes>
        {/* ========================================
            PUBLIC ROUTES (No Sidebar/Header)
            ======================================== */}
        <Route path="/login" element={<Login />} />

        {/* ========================================
            DASHBOARD ROUTES (Wrapped in Layout)
            ======================================== */}
        
        {/* 1. Public Dashboard Pages */}
        <Route path="/" element={
          <ProtectedRoute allowGuest redirectTo="/login">
            <DashboardLayout>
              <Homepage />
            </DashboardLayout>
          </ProtectedRoute>
        } />

        {/* 1.1 ORDER PLACEMENT */}
        <Route path="/order" element={
          <ProtectedRoute
            allowGuest
            allowedRoles={['admin', 'secretary', 'representative', 'member']}
            requiredPermissions={['canManageOrders']}
            anyPermission={true}
            customAccessDenied={
              <DashboardLayout>
                <AccessDenied 
                  message="You need order management permissions to place orders."
                  requiredPermissions={['canManageOrders']}
                  showUserInfo={true}
                />
              </DashboardLayout>
            }
          >
            <DashboardLayout>
              <Order />
            </DashboardLayout>
          </ProtectedRoute>
        } />

        {/* 1.2 ORDER TRACKING */}
        <Route path="/track-order" element={
          <ProtectedRoute
            allowGuest
            allowedRoles={['admin', 'secretary', 'representative', 'member']}
            requiredPermissions={['canManageOrders']}
            anyPermission={true}
            customAccessDenied={
              <DashboardLayout>
                <AccessDenied 
                  message="You need order management permissions to track orders."
                  requiredPermissions={['canManageOrders']}
                  showUserInfo={true}
                />
              </DashboardLayout>
            }
          >
            <DashboardLayout>
              <TrackOrder />
            </DashboardLayout>
          </ProtectedRoute>
        } />

        {/* 2. ADMIN ONLY ROUTES */}
        <Route path="/admin" element={
          <ProtectedRoute 
            allowedRoles={['admin']}
            customAccessDenied={
              <DashboardLayout>
                <AccessDenied 
                  message="Administrator access is required to view the admin dashboard."
                  requiredRole="admin"
                  showUserInfo={true}
                />
              </DashboardLayout>
            }
          >
            <DashboardLayout>
              <AdminPage />
            </DashboardLayout>
          </ProtectedRoute>
        } />

        {/* 2.1 ADMIN USER MANAGEMENT */}
        <Route path="/admin/users" element={
          <ProtectedRoute 
            allowedRoles={['admin']}
            requiredPermissions={['canManageUsers']}
            customAccessDenied={
              <DashboardLayout>
                <AccessDenied 
                  message="You need user management permissions to access this page."
                  requiredPermissions={['canManageUsers']}
                  showUserInfo={true}
                />
              </DashboardLayout>
            }
          >
            <DashboardLayout>
              <UserManagement />
            </DashboardLayout>
          </ProtectedRoute>
        } />

        {/* 2.2 ADMIN AUDIT TRAIL */}
        <Route path="/admin/audit" element={
          <ProtectedRoute 
            allowedRoles={['admin']}
            requiredPermissions={['canManageUsers']}
            customAccessDenied={
              <DashboardLayout>
                <AccessDenied 
                  message="You need user management permissions to view the audit trail."
                  requiredPermissions={['canManageUsers']}
                  showUserInfo={true}
                />
              </DashboardLayout>
            }
          >
            <DashboardLayout>
              <AuditTrail />
            </DashboardLayout>
          </ProtectedRoute>
        } />

        {/* 3. FINANCE DASHBOARD */}
        <Route path="/finance" element={
          <ProtectedRoute 
            allowedRoles={['admin', 'secretary', 'finance_secretary']}
            requiredPermissions={['canViewFinance']}
            anyPermission={true}
            customAccessDenied={
              <DashboardLayout>
                <AccessDenied 
                  message="You need finance viewing permissions to access the finance dashboard."
                  requiredPermissions={['canViewFinance']}
                  showUserInfo={true}
                />
              </DashboardLayout>
            }
          >
            <DashboardLayout>
              <FinanceDashboard />
            </DashboardLayout>
          </ProtectedRoute>
        } />

        {/* 4. INVENTORY MANAGEMENT */}
        <Route path="/inventory" element={
          <ProtectedRoute 
            allowedRoles={['admin', 'secretary', 'representative', 'senator']}
            requiredPermissions={['canManageProducts']}
            anyPermission={true}
            customAccessDenied={
              <DashboardLayout>
                <AccessDenied 
                  message="You need product management permissions to access inventory."
                  requiredPermissions={['canManageProducts']}
                  showUserInfo={true}
                />
              </DashboardLayout>
            }
          >
            <DashboardLayout>
              <InventoryManagement/>
            </DashboardLayout>
          </ProtectedRoute>
        } />

        {/* 5. COMMERCE HUB */}
        <Route path="/commerce" element={
          <ProtectedRoute 
            allowedRoles={['admin', 'secretary', 'representative', 'member']}
            requiredPermissions={['canManageOrders']}
            anyPermission={true}
            customAccessDenied={
              <DashboardLayout>
                <AccessDenied 
                  message="You need order management permissions to access the commerce hub."
                  requiredPermissions={['canManageOrders']}
                  showUserInfo={true}
                />
              </DashboardLayout>
            }
          >
            <DashboardLayout>
              <CommerceHub />
            </DashboardLayout>
          </ProtectedRoute>
        } />

        {/* 6. DOCUMENTS */}
        <Route path="/documents" element={
          <ProtectedRoute 
            allowedRoles={['admin', 'secretary', 'representative', 'senator']}
            requiredPermissions={['canExportData']}
            anyPermission={true}
            customAccessDenied={
              <DashboardLayout>
                <AccessDenied 
                  message="You need data export permissions to access documents."
                  requiredPermissions={['canExportData']}
                  showUserInfo={true}
                />
              </DashboardLayout>
            }
          >
            <DashboardLayout>
              <PDFDashboard />
            </DashboardLayout>
          </ProtectedRoute>
        } />

        {/* 7. REPORTS / ROSTER REGISTRY */}
        <Route path="/reports" element={
          <ProtectedRoute
            allowedRoles={['public', 'admin', 'secretary', 'governor', 'finance_secretary', 'senator', 'representative', 'member', 'guest']}
            requiredPermissions={['canSubmitRoster']}
            allowGuest
            customAccessDenied={
              <DashboardLayout>
                <AccessDenied
                  message="You need to be signed in to submit a class roster."
                  requiredPermissions={['canSubmitRoster']}
                  showUserInfo={true}
                />
              </DashboardLayout>
            }
          >
            <DashboardLayout>
              <ClassUpload />
            </DashboardLayout>
          </ProtectedRoute>
        } />

        {/* 7b. DEATH AID COLLECTION & REMITTANCE */}
        <Route path="/death-aid" element={
          <ProtectedRoute
            allowedRoles={['admin', 'secretary', 'finance_secretary', 'governor', 'senator', 'representative', 'member', 'guest']}
            requiredPermissions={['canSubmitRoster']}
            customAccessDenied={
              <DashboardLayout>
                <AccessDenied
                  message="Sign in with your Mayor or officer account to use Death Aid. Collections are tied to an account so the audit trail can name who submitted and who accepted the money."
                  requiredPermissions={['canSubmitRoster']}
                  showUserInfo={true}
                />
              </DashboardLayout>
            }
          >
            <DashboardLayout>
              <DeathAid />
            </DashboardLayout>
          </ProtectedRoute>
        } />

        {/* 8. ANNOUNCEMENTS */}
        <Route path="/announcement" element={
          <ProtectedRoute 
            allowedRoles={['admin', 'secretary', 'representative']}
            requiredPermissions={['canSendNotifications']}
            anyPermission={true}
            customAccessDenied={
              <DashboardLayout>
                <AccessDenied 
                  message="You need notification sending permissions to access announcements."
                  requiredPermissions={['canSendNotifications']}
                  showUserInfo={true}
                />
              </DashboardLayout>
            }
          >
            <DashboardLayout>
              <Announcement />
            </DashboardLayout>
          </ProtectedRoute>
        } />

        {/* 4. CATCH ALL */}
        <Route path="*" element={<div>404 - Page Not Found</div>} />

      </Routes>
      </FinanceProvider>
      </InventoryProvider>
    </AuthProvider>
    </ThemeProvider>
  );
}

export default App;