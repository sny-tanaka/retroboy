import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Preview } from "./Preview";

createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
        <Preview />
    </StrictMode>,
);
