"use client";

import { useRouter } from "next/navigation";
import AdminAuthForm from "@/components/admin/AdminAuthForm";

const SETUP_OWNER_STORAGE_KEY = "bookwise:setup-owner";

const AccountPage = () => {
  const router = useRouter();

  const createAdminAccount = async (values: AdminAuthFormValues) => {
    window.sessionStorage.setItem(
      SETUP_OWNER_STORAGE_KEY,
      JSON.stringify({
        fullName: `${values.firstName} ${values.lastName}`,
        email: values.email,
        password: values.password,
        userAvatar: values.avatarUrl,
        userAvatarFileId: values.avatarFileId ?? null,
      }),
    );

    router.push("/setup");
    router.refresh();

    return { success: true };
  };

  return <AdminAuthForm onSubmit={createAdminAccount} />;
};

export default AccountPage;
