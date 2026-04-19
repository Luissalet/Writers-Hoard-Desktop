import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import GlobalSearch from '../common/GlobalSearch';
import { installNavigator } from '@/engines/_shared/anchoring';

export default function MainLayout() {
  const navigate = useNavigate();

  // Expose the router's navigate to module-scoped anchor adapters so they
  // can jump to entities without reloading the page.
  useEffect(() => {
    installNavigator((to: string) => navigate(to));
  }, [navigate]);

  return (
    <div className="h-screen w-screen flex overflow-hidden grain-bg">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>
      <GlobalSearch />
    </div>
  );
}
