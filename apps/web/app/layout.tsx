import type { Metadata } from "next";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import "dmn-js/dist/assets/dmn-js-shared.css";
import "dmn-js/dist/assets/dmn-js-decision-table.css";
import "dmn-js/dist/assets/dmn-js-decision-table-controls.css";
import "dmn-js/dist/assets/dmn-js-drd.css";
import "dmn-js/dist/assets/dmn-js-literal-expression.css";
import "dmn-js/dist/assets/dmn-font/css/dmn.css";
import "@bpmn-io/form-js/dist/assets/form-js.css";
import "@bpmn-io/form-js/dist/assets/form-js-editor.css";
import "@copilotkit/react-core/v2/styles.css";

import { ShellBoundary } from "@/components/shell-boundary";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Wanaflow",
    template: "%s · Wanaflow",
  },
  description:
    "A calm, collaborative workspace for designing, approving, and running business processes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="default" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{var t=localStorage.getItem("wanaflow-theme");document.documentElement.dataset.theme=t==="claude"?"claude":"default"}catch(e){}})()',
          }}
        />
      </head>
      <body>
        <ShellBoundary>{children}</ShellBoundary>
      </body>
    </html>
  );
}
