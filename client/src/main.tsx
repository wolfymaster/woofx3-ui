import { createRoot } from "react-dom/client";
import { startThemeSync } from "@/lib/theme/sync";
import App from "./App";
import "./index.css";

startThemeSync();
createRoot(document.getElementById("root")!).render(<App />);
