import DashboardPage from "./pages/DashboardPage";
import TransactionsPage from "./pages/TransactionsPage";
import ConfigurationPage from "./pages/ConfigurationPage";
import ReportsPage from "./pages/ReportsPage";
import NetWorthPage from "./pages/NetWorthPage";
import RetirementPage from "./pages/RetirementPage";

// Single source of truth for both the route table (App.js) and the tab bar
// (AppShell.js). Adding a page means adding one entry here.
//
// `accent` mirrors the tab colours of the spreadsheet this app replaces, where
// the colour marks which family a tab belongs to rather than decorating it:
// configuration is yellow, the day-to-day ledger is red, and every reporting
// tab is blue. Classes are written out in full because Tailwind only keeps the
// class names it can see as literal strings.
export const navigation = [
  {
    path: "/",
    label: "Dashboard",
    Component: DashboardPage,
    accent: { text: "text-chalk", border: "border-chalk" },
  },
  {
    path: "/transactions",
    label: "Transactions",
    Component: TransactionsPage,
    accent: { text: "text-vermilion", border: "border-vermilion" },
  },
  {
    path: "/plan",
    label: "Configuration",
    Component: ConfigurationPage,
    accent: { text: "text-sulfur", border: "border-sulfur" },
  },
  {
    path: "/reports",
    label: "Reports",
    Component: ReportsPage,
    accent: { text: "text-azure", border: "border-azure" },
  },
  {
    path: "/net-worth",
    label: "Net worth",
    Component: NetWorthPage,
    accent: { text: "text-azure", border: "border-azure" },
  },
  {
    path: "/retirement",
    label: "Retirement",
    Component: RetirementPage,
    accent: { text: "text-azure", border: "border-azure" },
  },
];
