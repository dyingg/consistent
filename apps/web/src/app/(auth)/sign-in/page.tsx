"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "@/lib/auth-client";

const signInSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type SignInForm = z.infer<typeof signInSchema>;

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInForm>({
    resolver: zodResolver(signInSchema),
  });

  const onSubmit = async (data: SignInForm) => {
    setError(null);
    const result = await signIn.email({
      email: data.email,
      password: data.password,
    });

    if (result.error) {
      setError(result.error.message ?? "Sign in failed");
    } else {
      router.push("/");
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <header className="px-8 py-6">
        <span className="text-[15px] font-semibold tracking-tight text-[#fafafa]">
          Consistent
        </span>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1
              className="text-[32px] font-semibold text-[#fafafa]"
              style={{ letterSpacing: "-0.03em" }}
            >
              Welcome back
            </h1>
            <p className="mt-2 text-[14px] text-[#888]">
              Sign in to your account
            </p>
          </div>

          <div className="rounded-lg border border-white/[0.1] p-6">
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="space-y-5"
            >
              {error && (
                <div className="rounded-md border border-[rgba(255,68,68,0.15)] bg-[rgba(255,68,68,0.08)] px-3 py-2.5 text-[13px] text-[#ff4444]">
                  {error}
                </div>
              )}

              <div>
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-[13px] font-medium text-[#888]"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  {...register("email")}
                  className="w-full rounded-md border border-white/[0.1] bg-transparent px-3 py-2.5 text-[14px] text-[#fafafa] placeholder:text-[#444] outline-none transition-colors focus:border-white/[0.3]"
                />
                {errors.email && (
                  <p className="mt-1 text-[13px] text-[#ff4444]">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-1.5 block text-[13px] font-medium text-[#888]"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  {...register("password")}
                  className="w-full rounded-md border border-white/[0.1] bg-transparent px-3 py-2.5 text-[14px] text-[#fafafa] placeholder:text-[#444] outline-none transition-colors focus:border-white/[0.3]"
                />
                {errors.password && (
                  <p className="mt-1 text-[13px] text-[#ff4444]">
                    {errors.password.message}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-md bg-[#fafafa] py-2.5 text-[14px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Signing in..." : "Sign In"}
              </button>
            </form>
          </div>

          <p className="mt-6 text-center text-[13px] text-[#666]">
            Don&apos;t have an account?{" "}
            <Link href="/sign-up" className="text-[#fafafa] hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
