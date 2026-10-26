import { Navigate, Route, Routes } from "react-router-dom";
import { AppStoreProvider } from "./store";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { AppRoutes } from "./pages/AppPages";

export default function App() {
  return (
    <AppStoreProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/app/*" element={<AppRoutes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppStoreProvider>
  );
}
