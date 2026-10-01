import DashboardPage from "./pages/DashboardPage";
import DonationsPage from "./pages/DonationsPage";
import TransactionsPage from "./pages/TransactionsPage";
import ConfigurationPage from "./pages/ConfigurationPage";
import ReportsPage from "./pages/ReportsPage";
import NetWorthPage from "./pages/NetWorthPage";
import RetirementPage from "./pages/RetirementPage";
import SavingsGoalsPage from "./pages/SavingsGoalsPage";

// Single source of truth for both the route table (App.js) and the tab bar
// (AppShell.js). Adding a page means adding one entry here.
//
// `family` mirrors the tab colours of the spreadsheet this app replaces, where
// the colour marks which family a tab belongs to rather than decorating it:
// configuration is gold, the day-to-day ledger is rust, and every reporting tab
// is blue. It is drawn as a dot beside the label, so the active tab can wear the
// one underline colour every tab shares. Classes are written out in full
// because Tailwind only keeps the class names it can see as literal strings.
export const navigation = [
  {
    path: "/plan",
    label: "Configuration",
    Component: ConfigurationPage,
    family: "bg-coin",
  },
  {
    path: "/",
    label: "Dashboard",
    Component: DashboardPage,
    family: "bg-on-canopy",
  },
  {
    path: "/transactions",
    label: "Transactions",
    Component: TransactionsPage,
    family: "bg-on-canopy-rust",
  },
  {
    path: "/reports",
    label: "Reports",
    Component: ReportsPage,
    family: "bg-on-canopy-sky",
  },
  {
    path: "/donations",
    label: "Donations",
    Component: DonationsPage,
    family: "bg-on-canopy-sky",
  },
  {
    path: "/net-worth",
    label: "Net worth",
    Component: NetWorthPage,
    family: "bg-on-canopy-sky",
  },
  {
    path: "/retirement",
    label: "Retirement",
    Component: RetirementPage,
    family: "bg-on-canopy-sky",
  },
  {
    path: "/savings-goals",
    label: "Savings goals",
    Component: SavingsGoalsPage,
    family: "bg-on-canopy-sky",
  },
];
