import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { useAuth } from "./auth/context";
import { UserDocProvider } from "./data/UserDocProvider";
import { useUserDoc } from "./data/userDocContext";
import { useAccess } from "./data/hooks";
import { hasAccess, isOwner } from "../shared/access";
import ErrorBoundary from "./components/ErrorBoundary";
import AppShell from "./layout/AppShell";
import SignIn from "./pages/SignIn";
import Setup from "./pages/Setup";
import Today from "./pages/Today";
import Meals from "./pages/Meals";
import { Spinner } from "./components/ui";

// three.js, MediaPipe and Recharts together are the bulk of the bundle and
// none of them are needed to log a meal — the thing people open the app to
// do. Splitting them out keeps the first paint on a phone fast; the 3D and
// chart screens pay their own cost when opened.
const Weight = lazy(() => import("./pages/Weight"));
const Body = lazy(() => import("./pages/Body"));
const Training = lazy(() => import("./pages/Training"));
const SettingsPage = lazy(() => import("./pages/Settings"));

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <Gate />
        </ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
  );
}

function Gate() {
  const { user, loading, configured } = useAuth();

  if (!configured) return <ConfigMissing />;
  if (loading) return <FullScreenSpinner />;
  if (!user) return <SignIn />;
  return <InviteGate />;
}

/** Access is by invitation. The owner is always in — that is what makes
 *  locking yourself out impossible, and it means the very first sign-in
 *  works before any invite list exists. Everyone else is checked against
 *  `config/access`, which the rules only let an invited address read: a
 *  refused read and an address missing from the list mean the same thing.
 *
 *  This gate is for the message. The enforcement is in the security rules
 *  and in requireUser; deleting this component would change what the app
 *  says, not what it lets anyone do. */
function InviteGate() {
  const { user } = useAuth();
  const { access, loading, denied } = useAccess();

  if (isOwner(user?.email)) return <Authed />;
  if (loading) return <FullScreenSpinner />;
  if (denied || !hasAccess(user?.email, access)) return <NotAllowed />;
  return <Authed />;
}

/** Profile and goal gate every screen: without a height, a goal and a
 *  target date there is nothing to measure against, so the whole app
 *  would render empty states. Better to ask once, up front. */
function Authed() {
  return (
    <UserDocProvider>
      <Gated />
    </UserDocProvider>
  );
}

function Gated() {
  const { data, loading, error } = useUserDoc();

  if (loading) return <FullScreenSpinner />;
  if (error) {
    return (
      <CenteredNote title="データを読み込めませんでした">
        {error.message}
      </CenteredNote>
    );
  }
  if (!data.profile || !data.goal) return <Setup existing={data} />;

  return (
    <AppShell>
      <Suspense fallback={<FullScreenSpinner />}>
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/meals" element={<Meals />} />
          <Route path="/weight" element={<Weight />} />
          <Route path="/body" element={<Body />} />
          <Route path="/training" element={<Training />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/setup" element={<Setup existing={data} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

/** Signed in with a Google account this deployment does not serve. */
function NotAllowed() {
  const { user, signOutUser } = useAuth();
  return (
    <CenteredNote title="招待されていません">
      <p>
        <strong>{user?.email}</strong> はこのアプリに招待されていません。
        持ち主に招待してもらうか、別のアカウントでサインインし直してください。
      </p>
      <button
        onClick={signOutUser}
        className="mt-4 rounded-lg border border-rule px-3 py-1.5 text-sm"
      >
        サインアウト
      </button>
    </CenteredNote>
  );
}

function FullScreenSpinner() {
  return (
    <div className="flex h-full items-center justify-center text-muted">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

function CenteredNote({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-bold">{title}</h1>
      <p className="text-sm text-muted">{children}</p>
    </div>
  );
}

function ConfigMissing() {
  return (
    <CenteredNote title="Firebase の設定が必要です">
      <code className="rounded bg-sunk px-1.5 py-0.5">.env</code> に{" "}
      <code className="rounded bg-sunk px-1.5 py-0.5">VITE_FIREBASE_*</code> を
      設定してから再読み込みしてください。値は{" "}
      <code className="rounded bg-sunk px-1.5 py-0.5">.env.example</code>{" "}
      に一覧があります。
    </CenteredNote>
  );
}
