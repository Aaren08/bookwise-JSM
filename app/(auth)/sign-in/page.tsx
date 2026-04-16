import AuthForm from "@/components/AuthForm";
import { signInWithCredentials } from "@/lib/actions/auth";

const Page = () => (
  <AuthForm type="SIGN_IN" onSubmit={signInWithCredentials} />
);

export default Page;
