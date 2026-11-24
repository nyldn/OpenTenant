// Synthetic directional benchmark for the example assessment module.
import type { Benchmark } from "../types"
export const BENCHMARK: Benchmark = {
  "version": "Assessment benchmark v1 - Public Beta",
  "generated": "2026-05-28",
  "author": "OpenTenant",
  "sources": [
    "Stanford HAI AI Index 2025",
    "McKinsey State of AI 2025",
    "MITRE AI Maturity Model"
  ],
  "method_note": "Directional benchmark synthesized from public sources. Not a statistical claim. Cross-client anonymized benchmarks deferred until sample size supports it.",
  "overall_distribution": {
    "level_1": 0.12,
    "level_2": 0.34,
    "level_3": 0.31,
    "level_4": 0.17,
    "level_5": 0.06,
    "median_score": 2.32,
    "high_performer_score": 4.24
  },
  "pillars": {
    "strategy": {
      "name": "Strategy",
      "weight": 0.2,
      "industry_median": 2.3,
      "high_performer": 4.2,
      "gap": 1.9,
      "constraining_dimension": "ROI Framework and Value Measurement",
      "distribution": {
        "l1": 0.12,
        "l2": 0.34,
        "l3": 0.31,
        "l4": 0.17,
        "l5": 0.06
      },
      "key_signals": {
        "budget_pct_digital_median": 0.05,
        "budget_pct_digital_leader": 0.2,
        "board_oversight_pct": 0.27,
        "source": "McKinsey State of AI 2025"
      },
      "dimensions": [
        "AI Vision and Strategic Alignment",
        "Leadership Commitment and Sponsorship",
        "Use Case Identification and Prioritization",
        "ROI Framework and Value Measurement",
        "Competitive AI Positioning"
      ]
    },
    "business_processes_governance": {
      "name": "Business Processes and Governance",
      "weight": 0.2,
      "industry_median": 2.1,
      "high_performer": 4.4,
      "gap": 2.3,
      "constraining_dimension": "Workflow Redesign and Automation Readiness",
      "distribution": {
        "l1": 0.15,
        "l2": 0.4,
        "l3": 0.25,
        "l4": 0.14,
        "l5": 0.06
      },
      "key_signals": {
        "workflow_redesign_leader_pct": 0.55,
        "workflow_redesign_others_pct": 0.2,
        "ai_incident_rate_pct": 0.51,
        "source": "McKinsey State of AI 2025"
      },
      "dimensions": [
        "Process Documentation and Standardization",
        "Automation Readiness and Workflow Redesign",
        "AI Governance Policy",
        "Compliance and Risk Management",
        "Continuous Improvement"
      ]
    },
    "data_infrastructure": {
      "name": "Data and Infrastructure",
      "weight": 0.25,
      "industry_median": 2.4,
      "high_performer": 4.3,
      "gap": 1.9,
      "constraining_dimension": "Data Quality and Integration Architecture",
      "distribution": {
        "l1": 0.1,
        "l2": 0.35,
        "l3": 0.32,
        "l4": 0.17,
        "l5": 0.06
      },
      "key_signals": {
        "data_cited_as_primary_blocker": true,
        "source": "McKinsey State of AI 2025"
      },
      "dimensions": [
        "Data Quality and Governance",
        "Data Accessibility and Integration",
        "Infrastructure Readiness for AI Workloads",
        "Data Strategy and Monetization",
        "Data Lineage and Observability"
      ]
    },
    "technology_tools": {
      "name": "Technology and Tools",
      "weight": 0.2,
      "industry_median": 2.5,
      "high_performer": 4.2,
      "gap": 1.7,
      "constraining_dimension": "MLOps and AI Deployment Maturity",
      "distribution": {
        "l1": 0.12,
        "l2": 0.34,
        "l3": 0.31,
        "l4": 0.17,
        "l5": 0.06
      },
      "key_signals": {
        "adoption_any_function_pct": 0.88,
        "genai_use_pct": 0.71,
        "scaling_agentic_ai_pct": 0.23,
        "source": "McKinsey State of AI 2025, Stanford HAI 2025"
      },
      "dimensions": [
        "AI/ML Technology Stack",
        "Integration Architecture and API Maturity",
        "AI Vendor and Partner Management",
        "MLOps and AI Deployment Maturity",
        "Technical Debt and Modernization Trajectory"
      ]
    },
    "org_culture_talent": {
      "name": "Org, Culture and Talent",
      "weight": 0.15,
      "industry_median": 2.2,
      "high_performer": 4.1,
      "gap": 1.9,
      "constraining_dimension": "Change Readiness and Innovation Culture",
      "distribution": {
        "l1": 0.15,
        "l2": 0.4,
        "l3": 0.25,
        "l4": 0.14,
        "l5": 0.06
      },
      "key_signals": {
        "transformational_change_leader_multiplier": 3.6,
        "scaled_agents_leader_multiplier": 3,
        "source": "McKinsey State of AI 2025"
      },
      "dimensions": [
        "Change Readiness and Innovation Culture",
        "AI Organizational Structure and Governance",
        "AI Skills Inventory and Literacy",
        "Talent Strategy, Development and Retention",
        "AI Ethics, Responsibility and Trust"
      ]
    }
  },
  "level_definitions": {
    "1": {
      "name": "Ad-hoc",
      "mitre_equivalent": "Initial"
    },
    "2": {
      "name": "Developing",
      "mitre_equivalent": "Adopted"
    },
    "3": {
      "name": "Defined",
      "mitre_equivalent": "Defined"
    },
    "4": {
      "name": "Advanced",
      "mitre_equivalent": "Managed"
    },
    "5": {
      "name": "Leading",
      "mitre_equivalent": "Optimized"
    }
  }
}
