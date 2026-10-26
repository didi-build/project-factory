export type FactoryStep = {
  id: string;
  status: "done" | "skipped" | "planned" | "failed";
  detail?: string;
};

export type FactoryError = {
  error: {
    code: string;
    message: string;
    step?: string;
    retryable?: boolean;
  };
};

export type FactorySuccess = {
  request_id: string;
  status: string;
  steps: FactoryStep[];
  warnings: string[];
};
