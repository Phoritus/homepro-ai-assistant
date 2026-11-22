# Technical Specification: AI Sales & Customer Service Assistant (HomePro Pilot)

## 1. System Overview & Architecture
* **Objective:** Build an omnichannel AI assistant supporting pre-sales product recommendations and post-purchase customer support across two channels: **Web Chat** and **LINE Official Account (LINE OA)**.
* **Shared Backend:** Both channels must connect to a single unified backend service to ensure identical business logic, catalog/policy enforcement, and escalation rules.
* **Hybrid AI & Deterministic Design:**
  * Integrate at least one **real LLM API call** (local or free-tier models are acceptable) for natural language understanding, conversational flow, and response generation.
  * Enforce **deterministic checks** (hardcoded logic/validation) for factual constraints such as product pricing, stock availability, and policy eligibility to prevent hallucination.
* **Session & State Management:**
  * Maintain conversation history per user/session (`session_id` / `user_id`) so the assistant remembers previously provided context (e.g., room size or budget) across multi-turn conversations without re-asking.
  * Keep Web and LINE sessions isolated (cross-channel history syncing is not required).
* **Security & Privacy:**
  * Exclude all secrets, API keys, and LINE channel tokens from source code and version control. Provide a clean configuration template (e.g., `.env.example`).
  * Use strictly fictional data; do not integrate real payment gateways, live store credentials, or real customer PII.

---

## 2. Starter Data & Fixtures
The repository must retain the following exact fictional dataset and source IDs (additional records may be appended, provided the core fixtures remain intact):

### 2.1 Product Catalog
| SKU | Product Name | Price (THB) | Fit & Availability |
| :--- | :--- | :--- | :--- |
| `HP-F01` | 12-inch desk fan | ฿890 | Small room; 3 in stock at Demo Store |
| `HP-F02` | 16-inch pedestal fan | ฿1,390 | Medium room; 2 in stock at Demo Store |
| `HP-F03` | 18-inch pedestal fan | ฿1,790 | Large room; out of stock |

### 2.2 Customer Service Policies
| Policy ID | Policy Rule & Constraints |
| :--- | :--- |
| `SUP-01` | For unopened items, a return request may be reviewed within 14 days with proof of purchase. **Constraint:** Never promise or guarantee approval. |
| `SUP-02` | For order status inquiries or damaged deliveries, offer staff handoff. **Constraint:** Explicitly state that the demo has no order lookup or real ticketing system. |

---

## 3. Channel Specifications

### 3.1 Web Chat Interface
* Build a lightweight browser-based chat interface displaying conversation history.
* Render actionable next steps using demo-only product detail links or interactive buttons.

### 3.2 LINE Official Account Integration
* Implement a **LINE Messaging API** webhook endpoint and reply adapter.
* Support live interaction via a test LINE OA channel.
* *Fallback Verification:* If networking or account restrictions prevent live LINE delivery, support running synthetic LINE-formatted webhook events against a stubbed reply API, capturing the generated reply payload, and explicitly documenting live delivery as unverified.

---

## 4. Functional Flows

### 4.1 Flow A: AI Sales Assistant
1. **Needs & Budget Discovery:** Identify missing user constraints (specifically room size and budget) and ask clarifying questions before making a recommendation.
2. **Deterministic Filtering & Matching:** Filter the catalog strictly by `in_stock > 0` and `price <= user_budget`. Never recommend out-of-stock or over-budget items as valid matches.
3. **Recommendation:** Present a qualifying in-stock product including its **SKU**, **Price**, and **Reason** explaining why it fits the user's stated room size and budget.
4. **Next Step Action:** Provide a demo product detail link or demo checkout link/button. Do not process real payments or create actual orders.
5. **No-Match Handling:** If the requested item is out of stock or exceeds the budget, truthfully state the constraint and offer an eligible in-stock alternative or a clear no-match message.

### 4.2 Flow B: AI Customer Service
1. **Policy-Grounded Responses:** Answer support questions strictly using the named policy records (`SUP-01`, `SUP-02`).
2. **Return Inquiries (`SUP-01`):** Explain the 14-day review window for unopened items with proof of purchase while explicitly avoiding any guarantee of refund/approval.
3. **Escalation & Staff Handoff (`SUP-02`):** Trigger a staff handoff response when the user asks about:
   * Order status or tracking
   * Damaged deliveries
   * Warranties/guarantees not covered in the fixture
   * Any query outside the available fixture data
4. **Handoff Transparency:** Clearly inform the user that no real support ticket or order lookup exists in this system, and outline the structured context packet generated for human agents.

---

## 5. Error Handling & Diagnostics
* **LLM Failure Fallback:** If the LLM API fails, times out, or returns an invalid response, gracefully degrade to a helpful deterministic fallback message rather than crashing or fabricating information.
* **Diagnostics:** Implement structured logging for debugging and tracing requests without logging sensitive credentials or tokens.

---

## 6. Verification & Test Suite Requirements
Execute and document repeatable automated or scripted tests covering **at least 6 test cases**. Record the **Input**, **Expected Result**, **Observed Result**, **Pass/Fail Status**, **Total Passed Count**, and **1 Known System Limitation**.

### Mandatory Test Scenarios:
1. **Multi-Turn Sales Flow:** A shopper provides room size and budget across two separate turns and receives an eligible in-stock recommendation with its exact SKU.
2. **Out-of-Stock / Over-Budget Handling:** A request for an out-of-stock item (e.g., `HP-F03` / large room) or an item exceeding budget yields a truthful alternative or a clear no-match response.
3. **Returns Policy Compliance (`SUP-01`):** A question about product returns cites `SUP-01` rules (14 days, unopened, proof of purchase) without guaranteeing approval/refund.
4. **Handoff & Anti-Hallucination (`SUP-02`):** An order-status or damaged-delivery inquiry offers staff handoff without inventing fake order statuses or ticket IDs.
5. **Cross-Channel Parity:** Asking the identical business question on both Web Chat and LINE OA returns the same factual data and next-step action.
6. **Model Failure Resilience:** Simulating an LLM API failure results in a safe, helpful fallback message instead of an unhandled exception or fabricated answer.

---

## 7. Technical Documentation (`README.md`) Deliverables
The repository must include a `README.md` covering:
* **Flow Design & Success Criteria:** Diagrams/sketches of the Sales and Service flows, measurable success criteria for each, and clear decision boundaries (when to ask, answer, or hand off).
* **System Architecture:** An architecture diagram illustrating the shared backend, deterministic rules layer, LLM integration, and channel adapters.
* **Setup & Execution:** Step-by-step instructions to install dependencies, configure environment variables, run the server, and execute the test suite.
* **Handoff Payload Specification:** Documentation detailing what structured data/context a human support agent receives when a chat is escalated.
* **Pilot Metric:** Definition of one measurable pilot KPI with a target benchmark (e.g., *% of sales sessions reaching a valid product link*).
* **Known Limits & AI Disclosure:** Documentation of system limitations, plus a note disclosing any AI tools used during development and how their outputs were verified.