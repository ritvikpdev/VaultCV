/**
 * Canonical skill names and the ways a job description might spell them.
 *
 * This is the backbone of matching-without-a-key. A JD asking for "k8s",
 * "container orchestration" or "Kubernetes" must all resolve to the one
 * Kubernetes entry in your vault, or the tuner reports a gap you don't have.
 *
 * Not meant to be exhaustive — it seeds the alias field when you add a skill,
 * and you can edit the aliases afterwards. Coverage of your own stack matters
 * far more than breadth.
 */

export type AliasSeed = {
  canonical: string;
  category: string;
  aliases: string[];
};

export const SKILL_ALIAS_SEEDS: AliasSeed[] = [
  // ---- Languages ----
  { canonical: "Java", category: "Languages", aliases: ["java", "java se", "core java", "j2ee", "jakarta ee"] },
  { canonical: "Python", category: "Languages", aliases: ["python", "python3", "py"] },
  { canonical: "JavaScript", category: "Languages", aliases: ["javascript", "js", "es6", "ecmascript", "vanilla js"] },
  { canonical: "TypeScript", category: "Languages", aliases: ["typescript", "ts"] },
  { canonical: "C#", category: "Languages", aliases: ["c#", "csharp", "c sharp", "dotnet c#"] },
  { canonical: "Go", category: "Languages", aliases: ["go", "golang"] },
  { canonical: "SQL", category: "Languages", aliases: ["sql", "t-sql", "pl/sql", "ansi sql"] },
  { canonical: "C++", category: "Languages", aliases: ["c++", "cpp"] },
  { canonical: "Rust", category: "Languages", aliases: ["rust"] },
  { canonical: "Kotlin", category: "Languages", aliases: ["kotlin"] },
  { canonical: "Bash", category: "Languages", aliases: ["bash", "shell scripting", "shell", "sh", "zsh"] },

  // ---- Frameworks ----
  { canonical: "Spring Boot", category: "Frameworks", aliases: ["spring boot", "springboot", "spring", "spring framework", "spring mvc"] },
  { canonical: "Hibernate", category: "Frameworks", aliases: ["hibernate", "jpa", "orm"] },
  { canonical: "React", category: "Frameworks", aliases: ["react", "reactjs", "react.js"] },
  { canonical: "Next.js", category: "Frameworks", aliases: ["next.js", "nextjs", "next"] },
  { canonical: "Node.js", category: "Frameworks", aliases: ["node.js", "nodejs", "node"] },
  { canonical: "ASP.NET Core", category: "Frameworks", aliases: ["asp.net core", "asp.net", "aspnet", ".net core", "dotnet core", ".net"] },
  { canonical: "Express", category: "Frameworks", aliases: ["express", "express.js", "expressjs"] },
  { canonical: "Django", category: "Frameworks", aliases: ["django"] },
  { canonical: "Flask", category: "Frameworks", aliases: ["flask"] },
  { canonical: "FastAPI", category: "Frameworks", aliases: ["fastapi"] },
  { canonical: "Thymeleaf", category: "Frameworks", aliases: ["thymeleaf"] },

  // ---- Databases ----
  { canonical: "PostgreSQL", category: "Databases", aliases: ["postgresql", "postgres", "psql", "rds postgres"] },
  { canonical: "MySQL", category: "Databases", aliases: ["mysql", "mariadb"] },
  { canonical: "MS SQL Server", category: "Databases", aliases: ["ms sql server", "sql server", "mssql", "microsoft sql server", "t-sql"] },
  { canonical: "Oracle", category: "Databases", aliases: ["oracle", "oracle db", "oracle sql developer", "pl/sql"] },
  { canonical: "MongoDB", category: "Databases", aliases: ["mongodb", "mongo", "nosql", "document database"] },
  { canonical: "Redis", category: "Databases", aliases: ["redis", "in-memory cache", "caching layer"] },
  { canonical: "SQLite", category: "Databases", aliases: ["sqlite"] },
  { canonical: "DynamoDB", category: "Databases", aliases: ["dynamodb", "dynamo"] },

  // ---- Cloud & infra ----
  { canonical: "AWS", category: "Cloud & DevOps", aliases: ["aws", "amazon web services", "ec2", "s3", "lambda", "cloud platform"] },
  { canonical: "Azure", category: "Cloud & DevOps", aliases: ["azure", "microsoft azure"] },
  { canonical: "GCP", category: "Cloud & DevOps", aliases: ["gcp", "google cloud", "google cloud platform"] },
  { canonical: "Docker", category: "Cloud & DevOps", aliases: ["docker", "containers", "containerization", "containerized"] },
  { canonical: "Kubernetes", category: "Cloud & DevOps", aliases: ["kubernetes", "k8s", "container orchestration", "eks", "gke", "aks"] },
  { canonical: "Terraform", category: "Cloud & DevOps", aliases: ["terraform", "infrastructure as code", "iac"] },
  { canonical: "Jenkins", category: "Cloud & DevOps", aliases: ["jenkins"] },
  { canonical: "CI/CD", category: "Cloud & DevOps", aliases: ["ci/cd", "cicd", "continuous integration", "continuous delivery", "continuous deployment", "build pipelines", "github actions", "gitlab ci"] },
  { canonical: "Kafka", category: "Cloud & DevOps", aliases: ["kafka", "apache kafka", "event streaming", "message queue", "pub/sub"] },

  // ---- Tools ----
  { canonical: "Git", category: "Tools & Technologies", aliases: ["git", "github", "gitlab", "bitbucket", "version control", "source control"] },
  { canonical: "Maven", category: "Tools & Technologies", aliases: ["maven", "mvn"] },
  { canonical: "Gradle", category: "Tools & Technologies", aliases: ["gradle"] },
  { canonical: "Jira", category: "Tools & Technologies", aliases: ["jira", "atlassian"] },
  { canonical: "Postman", category: "Tools & Technologies", aliases: ["postman"] },

  // ---- Concepts ----
  { canonical: "REST APIs", category: "Concepts", aliases: ["rest", "restful", "rest api", "restful apis", "web services", "http api"] },
  { canonical: "GraphQL", category: "Concepts", aliases: ["graphql"] },
  { canonical: "Microservices", category: "Concepts", aliases: ["microservices", "microservice architecture", "service-oriented", "soa", "distributed services"] },
  { canonical: "Agile", category: "Concepts", aliases: ["agile", "scrum", "kanban", "sprints", "sprint planning"] },
  { canonical: "Unit Testing", category: "Concepts", aliases: ["unit testing", "junit", "jest", "pytest", "test coverage", "tdd", "automated testing"] },
  { canonical: "System Design", category: "Concepts", aliases: ["system design", "distributed systems", "scalability", "high availability", "architecture"] },
  { canonical: "Machine Learning", category: "Concepts", aliases: ["machine learning", "ml", "deep learning", "neural networks"] },
  { canonical: "Data Structures & Algorithms", category: "Concepts", aliases: ["data structures", "algorithms", "dsa", "problem solving"] },
];

const byLower = new Map<string, AliasSeed>();
for (const seed of SKILL_ALIAS_SEEDS) {
  byLower.set(seed.canonical.toLowerCase(), seed);
  for (const a of seed.aliases) byLower.set(a, seed);
}

/**
 * Look up a seed by canonical name or any known alias.
 * Used to pre-fill aliases and category when you type a skill name.
 */
export function findAliasSeed(name: string): AliasSeed | undefined {
  return byLower.get(name.trim().toLowerCase());
}

/** Normalize for comparison: lowercase, collapse whitespace, strip trailing punctuation. */
export function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/[.,;:!?)]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every string that should count as a hit for this skill: its own name plus
 * stored aliases plus any seeded aliases. Used by the deterministic matcher.
 */
export function matchTermsFor(name: string, storedAliases: string[]): string[] {
  const seed = findAliasSeed(name);
  const all = [name, ...storedAliases, ...(seed?.aliases ?? [])];
  return Array.from(new Set(all.map(normalizeTerm))).filter(Boolean);
}
