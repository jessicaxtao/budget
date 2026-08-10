import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell";
import { navigation } from "./navigation";

export default function App() {
  return (
    <AppShell>
      <Routes>
        {navigation.map(({ path, Component }) => (
          <Route key={path} path={path} element={<Component />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
