import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "../../lib/supabase";
import { Button } from "../../components/ui/button";
export const authSchema = z.object({
  email: z.email("Correo no válido"),
  password: z.string().min(8, "Usa al menos 8 caracteres").max(128),
});
export function Auth({ recovery = false }: { recovery?: boolean }) {
  const [mode, setMode] = useState<"login" | "register" | "reset" | "update">(
    recovery ? "update" : "login",
  );
  const [notice, setNotice] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof authSchema>>({
    resolver: zodResolver(
      z.object({
        email: mode === "update" ? z.string() : z.email("Correo no válido"),
        password:
          mode === "reset"
            ? z.string()
            : z.string().min(8, "Usa al menos 8 caracteres").max(128),
      }),
    ),
  });
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("update");
    });
    return () => data.subscription.unsubscribe();
  }, []);
  const submit = handleSubmit(async (values) => {
    try {
      const redirectTo = window.location.origin + import.meta.env.BASE_URL;
      const result =
        mode === "register"
          ? await supabase.auth.signUp({
              ...values,
              options: { emailRedirectTo: redirectTo },
            })
          : mode === "reset"
            ? await supabase.auth.resetPasswordForEmail(values.email, {
                redirectTo,
              })
            : mode === "update"
              ? await supabase.auth.updateUser({ password: values.password })
              : await supabase.auth.signInWithPassword(values);
      if (result.error) throw result.error;
      setNotice(
        mode === "register"
          ? "Revisa tu correo para confirmar tu cuenta."
          : mode === "reset"
            ? "Si la cuenta existe, recibirás un enlace."
            : mode === "update"
              ? "Contraseña actualizada."
              : "Sesión iniciada.",
      );
      if (mode === "update") window.location.reload();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "No se pudo completar la solicitud",
      );
    }
  });
  return (
    <div className="auth-page">
      <div className="auth-art">
        <span className="eyebrow">FORMA / TU ESPACIO DE IA</span>
        <h1>
          Las buenas ideas
          <br />
          empiezan con
          <br />
          <em>una conversación.</em>
        </h1>
        <p>Tu voz. Tus modelos. Tu forma de pensar.</p>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          ✳ forma<span>AI WORKSPACE</span>
        </div>
        <h2>
          {mode === "register"
            ? "Crea tu espacio"
            : mode === "reset"
              ? "Recupera tu cuenta"
              : mode === "update"
                ? "Nueva contraseña"
                : "Bienvenido de nuevo"}
        </h2>
        <p className="muted">Continúa donde dejaste tus ideas.</p>
        {mode !== "update" && (
          <label>
            Correo electrónico
            <input autoComplete="email" type="email" {...register("email")} />
          </label>
        )}
        {errors.email && <p role="alert">{errors.email.message}</p>}
        {mode !== "reset" && (
          <label>
            Contraseña
            <input
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              {...register("password")}
            />
          </label>
        )}
        {errors.password && <p role="alert">{errors.password.message}</p>}
        <Button disabled={isSubmitting}>
          {isSubmitting
            ? "Procesando…"
            : mode === "login"
              ? "Entrar a mi espacio"
              : "Continuar"}
        </Button>
        <p role="status">{notice}</p>
        <div className="row">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setMode(mode === "register" ? "login" : "register")}
          >
            {mode === "register" ? "Ya tengo cuenta" : "Crear cuenta"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setMode("reset")}
          >
            Olvidé mi contraseña
          </Button>
        </div>
      </form>
    </div>
  );
}
