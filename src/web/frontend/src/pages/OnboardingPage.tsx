import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CasheWordmark } from '@/components/ui/Brand';
import { useCurrentUser, useInvalidateCurrentUser } from '@/hooks/useCurrentUser';
import { api } from '@/api/client';
import {
  WelcomeStep,
  GmailStep,
  TelegramStep,
  AppleWalletStep,
} from '@/components/onboarding/steps';

type StepId = 'welcome' | 'gmail' | 'telegram' | 'apple_wallet';

function buildSteps(wantsGmail: boolean, wantsAppleWallet: boolean): StepId[] {
  const steps: StepId[] = ['welcome'];
  if (wantsGmail) steps.push('gmail');
  steps.push('telegram');
  if (wantsAppleWallet) steps.push('apple_wallet');
  return steps;
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const invalidateCurrentUser = useInvalidateCurrentUser();

  const [wantsGmail, setWantsGmail] = useState(user?.wants_gmail ?? true);
  const [wantsAppleWallet, setWantsAppleWallet] = useState(user?.wants_apple_wallet ?? true);
  const [steps, setSteps] = useState<StepId[]>(() =>
    buildSteps(user?.wants_gmail ?? true, user?.wants_apple_wallet ?? true)
  );
  const [stepIndex, setStepIndex] = useState(0);

  const currentStep = steps[stepIndex];
  const totalSteps = steps.length;

  const advance = () => setStepIndex((i) => i + 1);

  const handleWelcomeComplete = (gmail: boolean, appleWallet: boolean) => {
    setWantsGmail(gmail);
    setWantsAppleWallet(appleWallet);
    const newSteps = buildSteps(gmail, appleWallet);
    setSteps(newSteps);
    setStepIndex(1);
  };

  const [completeError, setCompleteError] = useState<string | null>(null);

  const handleFinalComplete = async () => {
    setCompleteError(null);
    try {
      await api.completeOnboarding();
      await invalidateCurrentUser();
      navigate('/');
    } catch {
      setCompleteError('Something went wrong. Please try again.');
    }
  };

  const isLastStep = stepIndex === totalSteps - 1;

  const renderStep = () => {
    switch (currentStep) {
      case 'welcome':
        return (
          <WelcomeStep
            username={user?.username ?? ''}
            initialWantsGmail={wantsGmail}
            initialWantsAppleWallet={wantsAppleWallet}
            onComplete={handleWelcomeComplete}
          />
        );
      case 'gmail':
        return (
          <GmailStep
            onComplete={isLastStep ? handleFinalComplete : advance}
            onSkip={advance}
          />
        );
      case 'telegram':
        return (
          <TelegramStep
            onComplete={isLastStep ? handleFinalComplete : advance}
            onSkip={advance}
          />
        );
      case 'apple_wallet':
        return (
          <AppleWalletStep
            onComplete={handleFinalComplete}
            onSkip={handleFinalComplete}
          />
        );
    }
  };

  // Show step indicator only after welcome (step 0)
  const showProgress = stepIndex > 0;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full bg-teal/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md space-y-6">
        {/* Branding header */}
        <div className="flex items-center gap-3">
          <CasheWordmark size={32} />
        </div>

        {/* Progress dots */}
        {showProgress && (
          <div className="flex items-center gap-1.5">
            {steps.slice(1).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i + 1 <= stepIndex
                    ? 'bg-teal w-4'
                    : 'bg-border w-1.5'
                }`}
              />
            ))}
          </div>
        )}

        {/* Step card */}
        <div className="bg-card border border-border rounded-xl p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {renderStep()}
            </motion.div>
          </AnimatePresence>
        </div>

        {completeError && (
          <p className="text-sm text-destructive text-center">{completeError}</p>
        )}
      </div>
    </div>
  );
}
