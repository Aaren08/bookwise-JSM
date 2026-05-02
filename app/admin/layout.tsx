// app/admin/layout.tsx
import { ReactNode } from "react";
import "@/app/styles/admin.css";
import Sidebar from "@/components/admin/Sidebar";
import Header from "@/components/admin/Header";
import { SearchProvider } from "@/components/admin/context/SearchContext";
import { requireAdmin } from "@/lib/admin/essentials/requireAdmin";
import SessionGuard from "@/components/admin/SessionGuard";

const Layout = async ({ children }: { children: ReactNode }) => {
  const session = await requireAdmin();

  return (
    <SearchProvider>
      <SessionGuard />
      <main className="flex min-h-screen flex-row w-full">
        <Sidebar session={session} />
        <div className="admin-container">
          <Header session={session} />
          {children}
        </div>
      </main>
    </SearchProvider>
  );
};

export default Layout;
