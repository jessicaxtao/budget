# Budget App Feature Research & Feature Wish List

> **Research Focus:** Understanding desired features from users of Actual Budget, YNAB, Rule-based budgeting apps (Spending Rules), Monarch Money, and other popular budgeting platforms. Excludes bank syncing/connections as a "nice-to-have" base feature.
>
> **Sources:** Reddit threads (r/budgets, r/personalfinance, r/actualbudget, r/MonarchMoney, r/YNAB), App Store & Play Store review sentiment analysis, product comparison articles (The Points Guy, NerdWallet, Forbes Advisor, etc.), and common user complaint patterns across platforms.

---

## 1. ACTUAL BUDGET ("ABC") — Feature Requests & User Pain Points

### What People Love About Actual Budget
- **True monthly rollover** (not a carryforward like YNAB) + "Sinking Funds" concept with envelope-style budgeting
- **Rule-based automation** (Spending Rules) for categorization and transfer auto-rules
- **Fully offline / self-hostable** — privacy-oriented users flock to this
- **Multiple account support**, joint accounts, custom accounts
- **Budget by category** (traditional zero-sum budgeting) with great flexibility

### Common Feature Requests from Actual Budget Community

| Category | Feature Request | Why People Want It |
|----------|-----------------|-------------------|
| **Charts & Visualizations** | Pie chart of spending by category *per month* or per date range | Easier "big picture" review than tables of numbers |
|  | Stacked bar chart for budget vs actual over time | See trends across months easily |
|  | Trend lines and moving averages | Identify if habits/behaviors are shifting |
|  | Heatmap calendar view (like GitHub contributions) showing spending color-coded by intensity per day | Visual "spending streak" awareness / guilt-free days |
|  | Category comparison radar/spider chart — side-by-side budget vs actual at a glance | Instantly see which buckets are over/under |
| **Reporting** | Exportable reports (PDF, CSV, XLSX) for tax time or accountant | Users need receipts and summaries for taxes/SOB |
|  | Custom report builder with drag-and-drop filters | Power users want to build their own views |
|  | "What-if" projections within reports (e.g. "what if I raise rent $200?") | Scenario planning without creating new budgets |
| **Rule-based / Automation** | Recurring rule engine with exceptions ("only first Friday of month") | Some rules are more complex than simple recurring |
|  | Rule-based alerts before they hit (e.g. "alert if category X is >80% spent") | Proactive warnings instead of reactive post-checking |
|  | Smart rule suggestions based on historical patterns ("I see you always pay Netflix the 3rd of each month - want me to automate?") | Reduce manual rule setup burden |
| **Mobile Experience** | Full offline mobile sync with conflict resolution | Users traveling or in low-connectivity zones |
|  | Quick-add transaction UI that's faster than data entry screens | "I just need to record $4.50 coffee" without navigation |
| **Multi-currency & Multi-language** | Native multi-currency support with auto-conversion | Digital nomads / expats |

### Actual Budget Reporting — Deep Dive

Actual Budget has a reporting engine that includes:

- **Budget Report** — Shows categories, budgeted amounts, assigned vs unassigned money, and rollover. Exportable.
- **Scheduled Transactions Report** — Preview of future auto-rules and recurring entries.
- **Monthly Transfer Report** — For tracking transfers between months.
- **Net Worth Report** — Balance sheet view as of a given date.
-
