export interface AnalystContextualLearningV1 {
  actionStatus: 'RECORDED' | 'NO_LEARNING' | 'NO_ANALYSIS';
  tenantId: string;
  campaignId: string;
  analysisId: string | null;
  learningId: string | null;
  learning: string | null;
  evidence: string[];
  confidence: 'low' | 'moderate' | null;
  recordedAt: string | null;
  nextStep: string;
  boundaries: {
    contextualOnly: true;
    universalRuleCreated: false;
    autonomousTrainingPerformed: false;
    metaWritePerformed: false;
    externalWritesAllowed: false;
    recommendationAutoExecuted: false;
  };
}
