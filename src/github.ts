import retry from 'async-retry';
import { Endpoints } from '@octokit/types';
import { info, warning } from '@actions/core';
import { Context } from '@actions/github/lib/context';
import { Octokit } from '@octokit/core';

export interface WorkflowRunPayload {
  id: number;
  url: string;
  run_number: number;
  workflow_id: number;
  workflow_url: string;
  name: string;
  event: string;
  status: 'queued' | 'completed';
  conclusion: 'success' | 'failure' | null;
  head_branch: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRun {
  id: number;
  url: string;
  runNumber: number;
  workflowId: number;
  workflowUrl: string;
  name: string;
  event: string;
  status: 'queued' | 'completed';
  conclusion: 'success' | 'failure' | null;
  headBranch: string;
  createdAt: Date;
  updatedAt: Date;
}

type BillingResponse =
  | Endpoints['GET /orgs/{org}/settings/billing/actions']['response']
  | Endpoints['GET /users/{username}/settings/billing/actions']['response'];

export type BillingData =
  | Endpoints['GET /orgs/{org}/settings/billing/actions']['response']['data']
  | Endpoints['GET /users/{username}/settings/billing/actions']['response']['data'];

export const parseWorkflowRun = (payload: WorkflowRunPayload): WorkflowRun => {
  return {
    id: payload.id,
    url: payload.url,
    runNumber: payload.run_number,
    workflowId: payload.workflow_id,
    workflowUrl: payload.workflow_url,
    name: payload.name,
    event: payload.event,
    status: payload.status,
    conclusion: payload.conclusion,
    headBranch: payload.head_branch,
    createdAt: new Date(payload.created_at),
    updatedAt: new Date(payload.updated_at),
  };
};

export const getWorkflowDuration = (workflowRun: WorkflowRun): number => {
  return (
    (workflowRun.updatedAt.getTime() - workflowRun.createdAt.getTime()) / 1000
  );
};

type getOwnerActionsBillingParams = {
  context: Context;
  octokit: Octokit;
};

export const getActionsBillingData = async ({
  context,
  octokit,
}: getOwnerActionsBillingParams): Promise<BillingData> => {
  const res = await requestActionsBilling(context, octokit);
  return res.data;
};

const requestActionsBilling = async (
  context: Context,
  octokit: Octokit,
): Promise<BillingResponse> => {
  const owner = context.repo.owner;

  return await retry(
    async () => {
      try {
        try {
          const result = await octokit.request(
            'GET /orgs/{org}/settings/billing/actions',
            {
              org: owner,
            },
          );
          info(`[INFO] ${JSON.stringify(result)}`);
          return result;
        } catch (err) {
          const result = await octokit.request(
            'GET /users/{username}/settings/billing/actions',
            {
              username: owner,
            },
          );
          info(`[INFO] ${JSON.stringify(result)}`);
          return result;
        }
      } catch (e) {
        warning(`[WARN] ${e}`);
        throw e;
      }
    },
    {
      retries: 3,
      factor: 3,
      minTimeout: 1 * 1000,
      maxTimeout: 30 * 1000,
      randomize: true,
    },
  );
};

export type Workflow =
  Endpoints['GET /repos/{owner}/{repo}/actions/workflows']['response']['data']['workflows'][0];
export type RepositoryWorkflowBilling = {
  UBUNTU?: { total_ms?: number | undefined };
  MACOS?: { total_ms?: number | undefined };
  WINDOWS?: { total_ms?: number | undefined };
};

export const getRepositoryWorkflowsAndBillings = async (
  context: Context,
  octokit: Octokit,
): Promise<[Workflow, RepositoryWorkflowBilling][]> => {
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const workflowsRes = await retry(
    async () => {
      try {
        const result = await octokit.request(
          'GET /repos/{owner}/{repo}/actions/workflows',
          { owner, repo },
        );
        info(`[INFO] ${JSON.stringify(result)}`);
        return result;
      } catch (e) {
        warning(`[WARN] ${e}`);
        throw e;
      }
    },
    {
      retries: 3,
      factor: 3,
      minTimeout: 1 * 1000,
      maxTimeout: 30 * 1000,
      randomize: true,
    },
  );
  const workflows = workflowsRes.data.workflows.filter(
    w => w.state === 'active',
  );
  const billingPromises: Promise<[Workflow, RepositoryWorkflowBilling]>[] =
    workflows.map(async workflow => {
      return new Promise(async resolved => {
        const res = await retry(
          async () => {
            try {
              const result = await octokit.request(
                'GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/timing',
                {
                  owner,
                  repo,
                  workflow_id: workflow.id,
                },
              );
              info(`[INFO] ${JSON.stringify(result)}`);
              return result;
            } catch (e) {
              warning(`[WARN] ${e}`);
              throw e;
            }
          },
          {
            retries: 3,
            factor: 3,
            minTimeout: 1 * 1000,
            maxTimeout: 30 * 1000,
            randomize: true,
          },
        );
        resolved([workflow, res.data.billable]);
      });
    });
  return Promise.all(billingPromises);
};
