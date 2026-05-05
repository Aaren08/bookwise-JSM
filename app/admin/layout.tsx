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
      <div className="flex h-screen overflow-hidden w-full">
        <Sidebar session={session} />
        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-light-300">
          <div className="p-5 sm:p-10">
            <Header session={session} />
            {children}
          </div>
        </main>
      </div>
    </SearchProvider>
  );
};

export default Layout;
