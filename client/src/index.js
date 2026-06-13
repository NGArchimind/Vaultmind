import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SharePage from "./components/SharePage";
import "./printReport.css";

const root = ReactDOM.createRoot(document.getElementById("root"));

const shareMatch = window.location.pathname.match(/^\/share\/([^/]+)/);
if (shareMatch) {
  root.render(<React.StrictMode><SharePage id={shareMatch[1]} /></React.StrictMode>);
} else {
  root.render(<React.StrictMode><App /></React.StrictMode>);
}
