// Generic assessment pillars and scoring rubrics.
import type { Pillar } from "../types"
export const PILLARS: Pillar[] = [
  {
    "key": "strategy",
    "name": "Strategy",
    "weight": 0.2,
    "description": "AI vision, leadership commitment, use case prioritization, ROI measurement, and competitive positioning. Strategy answers whether AI investment is connected to business outcomes that matter.",
    "dimensions": [
      {
        "key": "ai_vision",
        "name": "AI Vision & Strategic Alignment",
        "question": "How would you describe your organization's AI vision and its connection to business strategy?",
        "context": "Strategic vision should address how AI enhances delivery, creates new service lines, and differentiates methodology over a 1-3 year horizon.",
        "probes": [
          "Is there a documented AI strategy?",
          "How does AI connect to competitive differentiation?",
          "What business outcomes is AI expected to drive?",
          "Is AI strategy aligned with planning horizons?"
        ],
        "rubric": {
          "1": "Ad-hoc — No articulated AI vision. Efforts are reactive with no connection to business strategy.",
          "2": "Developing — Emerging awareness of AI potential. Informal discussions but no documented strategy.",
          "3": "Defined — Documented AI strategy exists but gaps remain in connecting to specific business outcomes.",
          "4": "Advanced — Clear AI strategy aligned to business objectives with defined success metrics and executive sponsorship.",
          "5": "Leading — AI is inseparable from business strategy. Leadership treats AI as a core competitive capability."
        }
      },
      {
        "key": "leadership_commitment",
        "name": "Leadership Commitment & Sponsorship",
        "question": "What level of executive sponsorship and investment commitment exists for AI initiatives?",
        "context": "Leadership commitment means willingness to transform delivery models and invest in internal capability before external revenue, with executive accountability tied to AI outcomes.",
        "probes": [
          "Is there C-suite sponsorship? Who specifically?",
          "Is there a committed budget for AI?",
          "Does the board receive AI progress updates?",
          "Are leaders personally engaged or delegating entirely?"
        ],
        "rubric": {
          "1": "Ad-hoc — No executive sponsorship. AI is a grassroots or IT-only initiative.",
          "2": "Developing — Passive executive awareness. Leaders acknowledge AI but haven't committed resources.",
          "3": "Defined — Active sponsorship from one or two executives. Budget allocated but not strategically protected.",
          "4": "Advanced — Strong C-suite alignment with dedicated budget and cross-functional steering committee.",
          "5": "Leading — CEO/Board-level AI governance. Investment is a strategic priority with executive KPIs tied to AI."
        }
      },
      {
        "key": "use_case_prioritization",
        "name": "Use Case Identification & Prioritization",
        "question": "How does your organization identify, evaluate, and prioritize AI use cases?",
        "context": "Use cases must be evaluated across both internal operations and client-facing delivery to maximize leverage.",
        "probes": [
          "Is there a formal process for identifying AI use cases?",
          "How are use cases scored (value vs. effort)?",
          "Are use cases aligned with strategic priorities?",
          "Is there a portfolio view of AI initiatives?"
        ],
        "rubric": {
          "1": "Ad-hoc — No systematic approach. Use cases emerge from vendor pitches or individual enthusiasm.",
          "2": "Developing — Informal list of potential use cases. Selection based on availability rather than strategic value.",
          "3": "Defined — Structured evaluation with value/effort scoring. Some alignment to strategy but portfolio management weak.",
          "4": "Advanced — Rigorous prioritization framework. Active portfolio management and sequencing.",
          "5": "Leading — Continuous use case discovery integrated into business planning. AI opportunity assessment is embedded everywhere."
        }
      },
      {
        "key": "roi_framework",
        "name": "ROI Framework & Value Measurement",
        "question": "How does your organization measure the return on AI investment, and how is value tracked from initiative to outcome?",
        "context": "Without a defined ROI framework, AI portfolios drift toward technology demos.",
        "probes": [
          "Is there a standard ROI calculation methodology for AI?",
          "How are productivity gains quantified and validated?",
          "Are revenue contributions from AI tracked separately?",
          "Is risk reduction included in the value model?"
        ],
        "rubric": {
          "1": "Ad-hoc — No ROI framework. AI initiatives evaluated on enthusiasm or compliance, not value.",
          "2": "Developing — Informal ROI claims. No standard methodology. Productivity gains anecdotal.",
          "3": "Defined — ROI framework exists. Productivity tracked for major initiatives. Value measurement uneven across portfolio.",
          "4": "Advanced — Rigorous value framework covering cost, productivity, revenue, and risk. Pre/post measurement standard.",
          "5": "Leading — AI ROI fully integrated into financial reporting. Value measurement informs portfolio reallocation in real time."
        }
      },
      {
        "key": "competitive_positioning",
        "name": "Competitive AI Positioning",
        "question": "How does your organization understand its AI position relative to competitors, and how does AI factor into market differentiation?",
        "context": "AI positioning is a strategic question, not just a technology one.",
        "probes": [
          "Is there a documented view of competitor AI capabilities?",
          "How does AI feature in your value proposition?",
          "Are clients/buyers asking about AI maturity?",
          "Is AI a stated differentiator in sales conversations?"
        ],
        "rubric": {
          "1": "Ad-hoc — No view of competitor AI positioning. AI not present in market messaging.",
          "2": "Developing — General awareness of competitor activity. AI mentioned in marketing but not differentiated.",
          "3": "Defined — Competitive scan completed. AI positioning articulated. Client conversations include AI capabilities.",
          "4": "Advanced — Clear AI differentiation in market. Competitive intelligence updated regularly. Wins/losses analyzed for AI factors.",
          "5": "Leading — AI is a core competitive moat. Market leadership in chosen AI domains. Buyers cite AI capability as decision factor."
        }
      }
    ]
  },
  {
    "key": "business_processes_governance",
    "name": "Business Processes & Governance",
    "weight": 0.2,
    "description": "Process documentation, automation readiness, AI governance, regulatory compliance, and continuous improvement. Example's BPM-first view: process readiness is a prerequisite to AI enablement, not a downstream consequence.",
    "dimensions": [
      {
        "key": "process_documentation",
        "name": "Process Documentation & Standardization",
        "question": "How well are your core business processes documented, standardized, and available for AI augmentation?",
        "context": "AI cannot augment what is not understood.",
        "probes": [
          "Are core processes documented and current?",
          "Is there a process standardization framework (BPMN, SOPs)?",
          "Are process owners defined?",
          "How frequently are processes reviewed?"
        ],
        "rubric": {
          "1": "Ad-hoc — Few documented processes. Tribal knowledge dominates. No process owners.",
          "2": "Developing — Some processes documented but inconsistent. Documentation often out of date.",
          "3": "Defined — Core processes documented in standard format. Process owners identified. Periodic reviews.",
          "4": "Advanced — Comprehensive process library with current documentation. Active process governance. Process metrics tracked.",
          "5": "Leading — Living process library integrated with operational systems. Real-time process intelligence. Process-as-code where appropriate."
        }
      },
      {
        "key": "process_automation",
        "name": "Process Automation Readiness",
        "question": "How mature is your organization in identifying, deploying, and managing automation across business processes?",
        "context": "Intelligent automation is the bridge between process discipline and AI.",
        "probes": [
          "Is RPA/workflow automation in production?",
          "Is there an automation pipeline or CoE?",
          "How are candidates for automation identified?",
          "What is the build/operate/manage model for automation?"
        ],
        "rubric": {
          "1": "Ad-hoc — No automation in production. Manual processes dominate.",
          "2": "Developing — Pilot automations in place. Limited operational support. Inconsistent identification of opportunities.",
          "3": "Defined — Automation portfolio in production. CoE or pipeline established. Standard development lifecycle.",
          "4": "Advanced — Mature automation operating model with intelligent automation (RPA + ML). Continuous opportunity identification.",
          "5": "Leading — Automation as a strategic capability. AI-augmented automation across the value chain. Automation teams partner with AI teams."
        }
      },
      {
        "key": "ai_governance",
        "name": "AI Governance & Policy Framework",
        "question": "Does your organization have a formal AI governance framework — policies, decision rights, and oversight structures for AI development and deployment?",
        "context": "AI governance covers model risk, data use, vendor selection, ethical review, and accountability.",
        "probes": [
          "Is there a written AI governance policy?",
          "Who has decision rights over AI deployment?",
          "Is there an AI review board or steering committee?",
          "Are model risk reviews performed?"
        ],
        "rubric": {
          "1": "Ad-hoc — No AI governance. Each team makes its own decisions.",
          "2": "Developing — Draft policies exist. Decision rights unclear. No formal review.",
          "3": "Defined — Policies published. Decision rights mapped. AI review board meets periodically.",
          "4": "Advanced — Comprehensive governance covering model risk, data, vendors, and ethics. Active oversight with audit trail.",
          "5": "Leading — AI governance integrated with enterprise risk and compliance. Continuous monitoring. Industry-leading transparency."
        }
      },
      {
        "key": "regulatory_compliance",
        "name": "Regulatory Compliance & Risk Management",
        "question": "How does your organization identify, monitor, and manage regulatory and operational risk for AI systems — especially for client-facing or regulated workloads?",
        "context": "Compliance posture is both a legal requirement and a stakeholder trust differentiator.",
        "probes": [
          "Are AI systems subject to compliance review?",
          "Is there a register of AI-related regulatory obligations?",
          "How are model decisions audited?",
          "Is there a process for client-specific compliance requirements?"
        ],
        "rubric": {
          "1": "Ad-hoc — No AI-specific compliance assessment. Regulatory exposure unknown.",
          "2": "Developing — Some awareness of regulatory issues. Reactive responses to client/auditor questions.",
          "3": "Defined — AI compliance framework in place. Major regulations mapped. Audit trails for key models.",
          "4": "Advanced — Comprehensive compliance program with proactive horizon scanning. Client compliance differentiator.",
          "5": "Leading — Compliance is a market differentiator. Real-time compliance monitoring. Anticipates regulatory direction."
        }
      },
      {
        "key": "continuous_improvement",
        "name": "Continuous Process Improvement Culture",
        "question": "How embedded is continuous improvement (Lean, Six Sigma, Kaizen) in your operating culture, and how does it intersect with AI initiatives?",
        "context": "CI culture predicts whether AI investments are optimized over time or left to decay.",
        "probes": [
          "Is there an active Lean/Six Sigma program?",
          "Are improvement metrics tracked at team level?",
          "Do AI initiatives include CI feedback loops?",
          "Are operators rewarded for surfacing improvements?"
        ],
        "rubric": {
          "1": "Ad-hoc — No CI program. Improvement happens by exception.",
          "2": "Developing — CI initiatives launched but inconsistent. Limited metric discipline.",
          "3": "Defined — Active CI program with trained practitioners. Standard metrics tracked. Some integration with AI work.",
          "4": "Advanced — CI is part of operating rhythm. AI initiatives explicitly include CI feedback. Cross-functional improvement teams.",
          "5": "Leading — CI culture is a competitive advantage. AI and CI teams co-locate. Improvement velocity is a tracked KPI."
        }
      }
    ]
  },
  {
    "key": "data_infrastructure",
    "name": "Data & Infrastructure",
    "weight": 0.25,
    "description": "Data quality, accessibility, infrastructure readiness, privacy & security controls, and strategic data positioning. Data is the central constraint for most AI initiatives.",
    "dimensions": [
      {
        "key": "data_quality",
        "name": "Data Quality & Governance",
        "question": "How would you rate the quality, completeness, and governance of your organization's data?",
        "context": "Assess both operational data and any external data environments used to deliver services.",
        "probes": [
          "Are there data quality metrics being tracked?",
          "Is there a data governance framework?",
          "How is data lineage tracked?",
          "What's the state of master data management?"
        ],
        "rubric": {
          "1": "Ad-hoc — Data siloed, inconsistent, ungoverned. No quality metrics or ownership defined.",
          "2": "Developing — Awareness of data quality issues. Some cleanup but no systematic governance.",
          "3": "Defined — Governance framework exists. Quality metrics tracked for key datasets. Gaps remain.",
          "4": "Advanced — Mature governance with clear ownership, quality SLAs, automated monitoring.",
          "5": "Leading — Data treated as strategic asset. Real-time quality monitoring, full lineage tracking."
        }
      },
      {
        "key": "data_accessibility",
        "name": "Data Accessibility & Integration",
        "question": "How easily can teams across your organization access and integrate the data they need?",
        "context": "Includes the ability to connect approved data environments and establish secure pipelines.",
        "probes": [
          "Are APIs available for key data sources?",
          "How mature is the data lake/warehouse?",
          "Can teams self-serve data needs?",
          "What integration patterns are in use?"
        ],
        "rubric": {
          "1": "Ad-hoc — Data locked in silos. Manual extraction required. No APIs.",
          "2": "Developing — Some point-to-point integrations. Data access requires IT involvement.",
          "3": "Defined — Central data repository exists. API layer covers major systems. Some self-service.",
          "4": "Advanced — Well-architected integration layer. Self-service analytics. Real-time data pipelines.",
          "5": "Leading — Unified data fabric/mesh. Full API coverage. Teams compose data products autonomously."
        }
      },
      {
        "key": "infrastructure_readiness",
        "name": "Infrastructure Readiness",
        "question": "Is your current infrastructure (cloud, compute, networking) ready to support AI workloads at scale?",
        "context": "Includes provisioning isolated environments and maintaining security boundaries.",
        "probes": [
          "Cloud vs. on-premise breakdown?",
          "GPU/compute capacity for AI workloads?",
          "MLOps or AI platform in place?",
          "Can infrastructure scale elastically?"
        ],
        "rubric": {
          "1": "Ad-hoc — Legacy on-premise. No cloud capability. No AI-specific compute.",
          "2": "Developing — Early cloud migration. Some experimentation on ad-hoc infrastructure.",
          "3": "Defined — Hybrid cloud. Dedicated AI compute available. Basic MLOps tooling.",
          "4": "Advanced — Cloud-native with elastic AI compute. Mature MLOps pipeline.",
          "5": "Leading — Fully scalable AI infrastructure. Automated model lifecycle. Edge + cloud AI."
        }
      },
      {
        "key": "data_privacy_security",
        "name": "Data Privacy & Security Controls",
        "question": "How robust are your data privacy and security controls — particularly for sensitive client data used in AI training and inference?",
        "context": "For organisations processing sensitive data at scale, privacy and security are foundational.",
        "probes": [
          "Is sensitive data classified and tagged?",
          "Are encryption-at-rest and in-transit standard?",
          "Is there a process for client data isolation?",
          "How is PII handled in AI training data?"
        ],
        "rubric": {
          "1": "Ad-hoc — No data classification. Encryption inconsistent. No isolation between client data.",
          "2": "Developing — Basic classification. Encryption widely deployed but with gaps. Manual isolation.",
          "3": "Defined — Data classification standard. Encryption universal. Client isolation enforced. PII process documented.",
          "4": "Advanced — Automated classification. Privacy-by-design. Tokenization/anonymization for AI training. Auditable controls.",
          "5": "Leading — Privacy and security are market differentiators. Continuous control validation. Advanced techniques (differential privacy, secure enclaves) in use."
        }
      },
      {
        "key": "data_strategy_monetization",
        "name": "Data Strategy & Monetization Potential",
        "question": "Does your organization have a strategic view of its proprietary data assets — what they are, what they could enable, and how they create competitive advantage?",
        "context": "Many organisations hold process and benchmark data that is underused as a strategic asset.",
        "probes": [
          "Is there a documented inventory of strategic data assets?",
          "Are data products defined and managed?",
          "Has the org evaluated data monetization opportunities?",
          "Are partner data exchanges in place?"
        ],
        "rubric": {
          "1": "Ad-hoc — Data viewed as operational byproduct. No strategic data assets identified.",
          "2": "Developing — Awareness of data value. Some discussion of data products. No formal strategy.",
          "3": "Defined — Strategic data assets inventoried. Data product owners assigned. Monetization explored.",
          "4": "Advanced — Active data product portfolio. Internal and partner data exchanges. Data assets contribute to revenue.",
          "5": "Leading — Data is a primary competitive asset. Multiple data-driven revenue streams. Data assets are board-level conversation."
        }
      }
    ]
  },
  {
    "key": "technology_tools",
    "name": "Technology & Tools",
    "weight": 0.2,
    "description": "AI/ML technology stack, integration architecture, vendor management, MLOps maturity, and technical debt. Security & compliance is held in the Business Processes & Governance pillar.",
    "dimensions": [
      {
        "key": "tech_stack",
        "name": "AI/ML Technology Stack",
        "question": "What AI/ML platforms, development tools, and deployment capabilities does your organization currently use?",
        "context": "Evaluate both internal tooling and the reusable components used to deliver services.",
        "probes": [
          "What AI/ML platforms are in use?",
          "Are there development and deployment pipelines?",
          "How many AI tools/platforms org-wide?",
          "Tool sprawl or consolidation?"
        ],
        "rubric": {
          "1": "Ad-hoc — No dedicated AI tools. Spreadsheets and basic analytics only.",
          "2": "Developing — Point solutions by individual teams. No platform strategy. Tool sprawl emerging.",
          "3": "Defined — Selected AI platform(s) in place. Development capabilities exist but deployment inconsistent.",
          "4": "Advanced — Integrated AI platform with CI/CD for models. Selective, deeply integrated tool strategy.",
          "5": "Leading — Enterprise AI platform with full lifecycle management. Composable AI services architecture."
        }
      },
      {
        "key": "integration_architecture",
        "name": "Integration Architecture & API Maturity",
        "question": "How well do your systems integrate with each other, and how mature is your API/microservices architecture?",
        "context": "Determines how rapidly AI-augmented services can be integrated into approved environments.",
        "probes": [
          "API management platform in use?",
          "Microservices vs. monolithic architecture?",
          "DevOps maturity level?",
          "Can AI models embed into existing workflows?"
        ],
        "rubric": {
          "1": "Ad-hoc — Monolithic systems with no API layer. Custom development for each connection.",
          "2": "Developing — Some APIs exist. Integration is project-by-project. No API management.",
          "3": "Defined — API management adopted. Mix of microservices and monoliths. DevOps emerging.",
          "4": "Advanced — API-first architecture. Microservices for key capabilities. AI models integrate as services.",
          "5": "Leading — Composable enterprise. Event-driven integration. AI services are first-class citizens."
        }
      },
      {
        "key": "vendor_management",
        "name": "AI Vendor & Partner Management",
        "question": "How effectively does your organization evaluate, select, and manage AI technology vendors and partners?",
        "context": "Vendor decisions compound; lock-in or weak evaluation constrains the AI roadmap.",
        "probes": [
          "Is there a formal AI vendor evaluation process?",
          "How are vendor SLAs monitored for AI systems?",
          "Is there a build/buy/partner decision framework?",
          "How is vendor lock-in risk managed?"
        ],
        "rubric": {
          "1": "Ad-hoc — Vendors selected based on relationships. No evaluation framework.",
          "2": "Developing — Some vendor evaluation but inconsistent. Limited SLA oversight for AI systems.",
          "3": "Defined — Vendor evaluation framework in place. AI-specific SLAs defined.",
          "4": "Advanced — Strategic vendor partnerships with clear performance accountability. Build/buy/partner framework in use.",
          "5": "Leading — AI vendor ecosystem actively managed as a competitive asset. Co-development agreements with key partners."
        }
      },
      {
        "key": "mlops_maturity",
        "name": "MLOps & AI Deployment Maturity",
        "question": "How mature is your organization's ability to deploy, monitor, and maintain AI models in production?",
        "context": "MLOps maturity is the gap between demo and value.",
        "probes": [
          "Is there a repeatable model deployment pipeline?",
          "How are models monitored in production?",
          "Is there model versioning and rollback capability?",
          "How is model drift detected?"
        ],
        "rubric": {
          "1": "Ad-hoc — No production AI models. No deployment process.",
          "2": "Developing — Models deployed manually. Limited monitoring. No standard process.",
          "3": "Defined — Deployment pipeline exists. Basic monitoring. Versioning standard.",
          "4": "Advanced — Mature MLOps with automated deployment, drift detection, retraining triggers, full observability.",
          "5": "Leading — Industry-leading MLOps. Models continuously improved. Self-healing AI systems where appropriate."
        }
      },
      {
        "key": "technical_debt",
        "name": "Technical Debt & Modernization Trajectory",
        "question": "How significant is technical debt in legacy systems, and what is the modernization trajectory?",
        "context": "Legacy system debt is one of the most common blockers to dependable AI deployment.",
        "probes": [
          "Is there a technical debt register?",
          "What percent of architecture is legacy vs. modern?",
          "Is there an active modernization program?",
          "How is technical debt prioritized vs. new capability?"
        ],
        "rubric": {
          "1": "Ad-hoc — Heavy legacy footprint. No modernization plan. Technical debt accumulating.",
          "2": "Developing — Awareness of debt issues. Tactical modernization but no strategy.",
          "3": "Defined — Technical debt register maintained. Modernization roadmap published. Selective progress.",
          "4": "Advanced — Active modernization program with funded backlog. Debt service treated like financial debt.",
          "5": "Leading — Modernization is continuous. Architecture evolves alongside capability needs. Debt held at strategic level."
        }
      }
    ]
  },
  {
    "key": "org_culture_talent",
    "name": "Org, Culture & Talent",
    "weight": 0.15,
    "description": "Change readiness, AI organizational structure, skills inventory, talent strategy, and AI ethics. Merged from v1.x Organization & Culture + Skills & Talent per Example's view that human transformation is one integrated system.",
    "dimensions": [
      {
        "key": "change_readiness",
        "name": "Change Readiness & Innovation Culture",
        "question": "How has your organization historically handled major technology transformations, and what's the appetite for AI-driven change?",
        "context": "Organisations must change internal operations while building the capability to support users through transformation.",
        "probes": [
          "History of successful transformations?",
          "Organizational risk tolerance?",
          "Innovation culture strength?",
          "Change fatigue levels?"
        ],
        "rubric": {
          "1": "Ad-hoc — History of failed transformations. High resistance to change. Risk-averse culture.",
          "2": "Developing — Mixed history. Pockets of innovation but generally cautious. Change fatigue present.",
          "3": "Defined — Some successful transformations. Growing innovation culture. Middle management bottleneck.",
          "4": "Advanced — Strong transformation track record. Innovation encouraged. Organization adapts well.",
          "5": "Leading — Transformation embedded in DNA. Continuous improvement. Organization proactively drives AI change."
        }
      },
      {
        "key": "org_structure_governance",
        "name": "AI Organizational Structure & Governance",
        "question": "How is AI ownership structured — centralized, distributed, or hybrid — and how mature is the AI operating model?",
        "context": "Structure should support both internal AI capability and dependable delivery into operational contexts.",
        "probes": [
          "Center of Excellence or AI team?",
          "Cross-functional collaboration maturity?",
          "Decision-making speed for AI?",
          "Operating model effectiveness?"
        ],
        "rubric": {
          "1": "Ad-hoc — No dedicated AI function. Ownership unclear. Decisions slow and fragmented.",
          "2": "Developing — IT owns AI by default. Limited cross-functional engagement. Decision bottlenecks.",
          "3": "Defined — AI team or CoE established. Growing collaboration. Operating model defined but not fully operational.",
          "4": "Advanced — Hybrid model with central CoE and embedded AI champions. Clear decision rights.",
          "5": "Leading — Federated AI model. Every BU has AI capability. CoE provides platform and standards."
        }
      },
      {
        "key": "skills_literacy",
        "name": "AI Skills Inventory & Literacy",
        "question": "What AI-related skills and AI literacy currently exist across your organization — both deep practitioner skills and broad workforce literacy?",
        "context": "Skills must cover both building AI solutions and helping users adopt new ways of working.",
        "probes": [
          "Data scientists and ML engineers on staff?",
          "Domain experts with AI training?",
          "Change management capability?",
          "AI literacy programs across the workforce?"
        ],
        "rubric": {
          "1": "Ad-hoc — No dedicated AI skills. Reliance on general IT. Zero AI literacy programs.",
          "2": "Developing — A few self-taught practitioners. Some experimentation but no formal AI roles.",
          "3": "Defined — Dedicated AI team hired. Basic literacy program launched. Gaps in specific domains.",
          "4": "Advanced — Strong AI team with diverse skills. Literacy widespread. Domain experts collaborate with AI specialists.",
          "5": "Leading — AI skills embedded across all functions. Continuous learning. Organization is an AI talent destination."
        }
      },
      {
        "key": "talent_strategy",
        "name": "Talent Strategy, Development & Retention",
        "question": "How does your organization attract, develop, and retain AI talent — and what is the strategy for closing identified skills gaps?",
        "context": "Organisations must balance delivery commitments with sufficient capacity for internal innovation.",
        "probes": [
          "Formal skills gap analysis?",
          "Training and upskilling programs?",
          "Hiring strategy for AI talent?",
          "Build vs. buy vs. partner decisions?",
          "AI talent retention rates and career paths?"
        ],
        "rubric": {
          "1": "Ad-hoc — No gap analysis. No training. AI talent not a priority. High turnover.",
          "2": "Developing — Informal understanding of gaps. Ad-hoc training. Struggling to attract or retain talent.",
          "3": "Defined — Formal gap analysis. Training programs launched. Hiring strategy defined. Career paths emerging.",
          "4": "Advanced — Comprehensive talent strategy with build/buy/partner. Active upskilling. Strong retention. Mentorship and rotation programs.",
          "5": "Leading — Predictive workforce planning. World-class training. Partnership ecosystem. Talent magnet — others want to hire your people."
        }
      },
      {
        "key": "ai_ethics",
        "name": "AI Ethics, Responsibility & Trust",
        "question": "How does your organization approach AI ethics, responsibility, and trust — both internally and in client-facing AI applications?",
        "context": "For organisations processing data at scale, responsible AI is both a risk requirement and a trust differentiator.",
        "probes": [
          "Is there a published responsible AI framework?",
          "Are bias and fairness assessments performed?",
          "How is AI explainability handled?",
          "Are human-in-the-loop standards defined?"
        ],
        "rubric": {
          "1": "Ad-hoc — No responsible AI framework. Ethics considered only when issues surface.",
          "2": "Developing — Awareness of ethics issues. Some informal practices. No standard framework.",
          "3": "Defined — Responsible AI framework published. Bias assessments for major models. Explainability addressed where required.",
          "4": "Advanced — Comprehensive responsible AI program. Pre-deployment ethics review standard. Human oversight standards in place.",
          "5": "Leading — Responsible AI is a market differentiator. Public commitments. Industry leadership in ethical AI practice."
        }
      }
    ]
  }
]
