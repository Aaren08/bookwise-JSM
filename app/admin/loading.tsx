const AdminLoading = () => {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="flex flex-col gap-3">
        <div className="h-8 w-64 rounded bg-slate-200" />
        <div className="h-5 w-80 rounded bg-slate-200" />
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-32 rounded-2xl bg-slate-200" />
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <div className="h-56 rounded-2xl bg-slate-200" />
          <div className="h-56 rounded-2xl bg-slate-200" />
        </div>
        <div className="h-[470px] rounded-2xl bg-slate-200" />
      </div>
    </div>
  );
};

export default AdminLoading;
