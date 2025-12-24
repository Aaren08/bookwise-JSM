import { ReactNode } from "react";

const Ping = ({ children }: { children: ReactNode }) => {
  return (
    <div className="relative inline-block">
      <span className="absolute inset-0 animate-ping rounded-md bg-emerald-400 opacity-75"></span>
      <div className="relative z-10">{children}</div>
    </div>
  );
};

export default Ping;
