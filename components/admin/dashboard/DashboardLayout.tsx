import { ReactNode } from "react";

interface DashboardLayoutProps {
  children: ReactNode;
}

const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  return <div className="w-full space-y-6">{children}</div>;
};

export default DashboardLayout;
