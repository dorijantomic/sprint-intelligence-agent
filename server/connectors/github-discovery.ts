export interface GitHubIterationOption {
  id: string;
  title: string;
  startDate: string;
  duration: number;
  completed: boolean;
}

export interface GitHubProjectOption {
  id: string;
  owner: string;
  number: number;
  title: string;
  url: string;
  iterations: GitHubIterationOption[];
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly kind: "authentication" | "provider",
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

const DISCOVERY_QUERY = `
  query SprintIntelligenceProjectDiscovery {
    viewer {
      login
      projectsV2(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes { ...ProjectOption }
      }
      organizations(first: 50) {
        nodes {
          login
          projectsV2(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes { ...ProjectOption }
          }
        }
      }
    }
  }

  fragment ProjectOption on ProjectV2 {
    id
    number
    title
    url
    fields(first: 50) {
      nodes {
        ... on ProjectV2IterationField {
          configuration {
            iterations { id title startDate duration }
            completedIterations { id title startDate duration }
          }
        }
      }
    }
  }
`;

interface IterationNode {
  id: string;
  title: string;
  startDate: string;
  duration: number;
}

interface ProjectNode {
  id: string;
  number: number;
  title: string;
  url: string;
  fields: {
    nodes: Array<{
      configuration?: {
        iterations: IterationNode[];
        completedIterations: IterationNode[];
      };
    } | null>;
  };
}

interface DiscoveryData {
  viewer: {
    login: string;
    projectsV2: { nodes: Array<ProjectNode | null> };
    organizations: {
      nodes: Array<{
        login: string;
        projectsV2: { nodes: Array<ProjectNode | null> };
      } | null>;
    };
  } | null;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

function normalizeProject(owner: string, project: ProjectNode): GitHubProjectOption {
  const iterations = new Map<string, GitHubIterationOption>();
  for (const field of project.fields.nodes) {
    for (const iteration of field?.configuration?.iterations ?? []) {
      iterations.set(iteration.id, { ...iteration, completed: false });
    }
    for (const iteration of field?.configuration?.completedIterations ?? []) {
      if (!iterations.has(iteration.id)) {
        iterations.set(iteration.id, { ...iteration, completed: true });
      }
    }
  }

  return {
    id: project.id,
    owner,
    number: project.number,
    title: project.title,
    url: project.url,
    iterations: [...iterations.values()].sort((left, right) =>
      right.startDate.localeCompare(left.startDate),
    ),
  };
}

function isAuthenticationMessage(message: string): boolean {
  return /authentication|credentials|forbidden|resource not accessible|scope/i.test(
    message,
  );
}

export async function discoverGitHubProjects(
  token: string,
  request: typeof fetch = fetch,
): Promise<GitHubProjectOption[]> {
  const response = await request("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2026-03-10",
    },
    body: JSON.stringify({ query: DISCOVERY_QUERY }),
  });

  if (!response.ok) {
    const kind = response.status === 401 || response.status === 403
      ? "authentication"
      : "provider";
    throw new GitHubApiError(
      kind === "authentication"
        ? "GitHub authentication is missing or lacks read:project access."
        : `GitHub project discovery failed with HTTP ${response.status}.`,
      kind,
    );
  }

  const payload = (await response.json()) as GraphQLResponse<DiscoveryData>;
  if (payload.errors?.length) {
    const message = payload.errors.map((error) => error.message).join("; ");
    throw new GitHubApiError(
      `GitHub project discovery failed: ${message}`,
      isAuthenticationMessage(message) ? "authentication" : "provider",
    );
  }
  if (!payload.data?.viewer) {
    throw new GitHubApiError(
      "GitHub project discovery returned no authenticated viewer.",
      "authentication",
    );
  }

  const viewer = payload.data.viewer;
  const projects = viewer.projectsV2.nodes
    .filter((project): project is ProjectNode => project !== null)
    .map((project) => normalizeProject(viewer.login, project));
  for (const organization of viewer.organizations.nodes) {
    if (!organization) continue;
    projects.push(
      ...organization.projectsV2.nodes
        .filter((project): project is ProjectNode => project !== null)
        .map((project) => normalizeProject(organization.login, project)),
    );
  }

  return projects.sort((left, right) => {
    const leftPersonal = left.owner === viewer.login ? 1 : 0;
    const rightPersonal = right.owner === viewer.login ? 1 : 0;
    if (leftPersonal !== rightPersonal) return rightPersonal - leftPersonal;
    const leftActive = left.iterations.some((iteration) => !iteration.completed) ? 1 : 0;
    const rightActive = right.iterations.some((iteration) => !iteration.completed) ? 1 : 0;
    if (leftActive !== rightActive) return rightActive - leftActive;
    return `${left.owner}/${left.title}`.localeCompare(`${right.owner}/${right.title}`);
  });
}
