import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MobileStepper from '@mui/material/MobileStepper';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import IconButton from '../buttons/IconButton';
import TextButton from '../buttons/TextButton';
import { getButtonIconUrl } from '../../utils/buttonAssets';
import starFilledIcon from '../../assets/images/buttons/star-filled.png';
import { useGemData } from '../../contexts/useGemData';
import { generateExampleSetups } from '../../utils/exampleSetups';

const tutorialImages = import.meta.glob<{ default: string }>('../../assets/images/tutorial/*.png', { eager: true });

function getTutorialImage(step: number): string {
  const key = `../../assets/images/tutorial/step-${step + 1}.png`;
  return tutorialImages[key]?.default ?? '';
}

const plusIcon = getButtonIconUrl('plus');
const cogIcon = getButtonIconUrl('cog');

function InlineIcon({ src, alt }: { src: string; alt: string }) {
  return <Box component="img" src={src} alt={alt} sx={{ width: 18, height: 18, verticalAlign: 'middle', mx: 0.3 }} />;
}

const STEP_TITLES: (string | null)[] = [null, null, null, null, null, null, 'Work in Progress'];

/** One optional-setting entry, rendered as an accordion in tutorial step 5. */
const FEATURE_HELP: { title: ReactNode; body: ReactNode }[] = [
  {
    title: 'Suggest upgrades',
    body: 'Recommends upgrading gems for better results, spending spare copies of a gem as fodder to raise a socketed gem’s rank.',
  },
  {
    title: (
      <>
        Convert R1 <InlineIcon src={starFilledIcon} alt="1-star" /> gems
      </>
    ),
    body: 'Converts spare rank-1 1-star gems to gem power directly if needed — they’re otherwise worthless both as a socketed gem and as upgrade fodder.',
  },
  {
    title: 'Activate bonuses',
    body: (
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        <Box component="li" sx={{ mb: 0.5 }}>
          <strong>Off</strong> — bonuses are only activated when they cost nothing (a tie between equally good gems).
        </Box>
        <Box component="li" sx={{ mb: 0.5 }}>
          <strong>Budget</strong> — after the best setup is found, leftover gem power is spent activating bonuses. Always stays within your
          gem power: if a setup was achievable without this option, it still is.
        </Box>
        <Box component="li">
          <strong>Forced</strong> — always prefers a bonus-activating gem while building the setup. Activates the most bonuses, but can make
          a setup unachievable even when one was achievable without it.
        </Box>
      </Box>
    ),
  },
];

const STEP_DESCRIPTIONS_STATIC: ReactNode[] = [
  <>Use "Power Extraction" to extract power from gems you want to use. This makes the gems dormant and places them into your inventory.</>,
  <>Equip the dormant gems again. Make sure there's no gem power left in any of the gems.</>,
  <>Add the gems you want to use in the gear section with the correct star level and rank.</>,
  <>
    Add available gems in the inventory section by clicking an empty slot or the <InlineIcon src={plusIcon} alt="+" /> button. Only add
    awakened gems. Also add your gem fragment count.
  </>,
  <>
    Access optional settings via the <InlineIcon src={cogIcon} alt="settings" /> button:
    <Box sx={{ mt: 1 }}>
      {FEATURE_HELP.map((feature, index) => (
        <Accordion key={index} disableGutters sx={{ '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {feature.title}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" component="div">
              {feature.body}
            </Typography>
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
    <Alert severity="warning" sx={{ mt: 1.5 }}>
      <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 0.5 }}>
        CAUTION: Understand the system before acting on suggestions
      </Typography>
      <Typography variant="body2" component="span" sx={{ display: 'block' }}>
        Gem upgrades and conversions are <strong>irreversible</strong> and can lock you into a specific gem setup. Socketed gems only count
        toward the awakening cost of{' '}
        <strong>
          5<InlineIcon src={starFilledIcon} alt="5-star" /> gems
        </strong>{' '}
        — 1
        <InlineIcon src={starFilledIcon} alt="1-star" /> and 2
        <InlineIcon src={starFilledIcon} alt="2-star" /> gems must be awakened using gem power <strong>alone</strong>. Make sure you
        understand how the awakening system works before making any in-game changes.
      </Typography>
    </Alert>
  </>,
  <>Click "Optimize" to find the best gem arrangement.</>,
];

const TOTAL_STEPS = STEP_DESCRIPTIONS_STATIC.length + 1; // +1 for step 7

function CopyableCode({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Box sx={{ mt: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        <TextButton size="xxs" scale={0.75} onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy'}
        </TextButton>
      </Box>
      <Box
        sx={{
          fontFamily: 'monospace',
          fontSize: '0.65rem',
          wordBreak: 'break-all',
          bgcolor: 'rgba(0,0,0,0.25)',
          borderRadius: 1,
          p: 1,
          maxHeight: 64,
          overflowY: 'auto',
          userSelect: 'all',
        }}
      >
        {code}
      </Box>
    </Box>
  );
}

interface TutorialDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function TutorialDialog({ open, onClose }: TutorialDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [activeStep, setActiveStep] = useState(0);
  const { gems } = useGemData();
  const examples = useMemo(() => (gems.length > 0 ? generateExampleSetups(gems) : null), [gems]);

  // Reset to the first step whenever the dialog transitions from closed to
  // open. Adjusting state during render (rather than in an effect) avoids
  // an extra render pass; see https://react.dev/learn/you-might-not-need-an-effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setActiveStep(0);
  }

  function handleBack() {
    setActiveStep((prev) => prev - 1);
  }

  function handleNext() {
    setActiveStep((prev) => prev + 1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowLeft' && activeStep > 0) handleBack();
    if (e.key === 'ArrowRight' && activeStep < TOTAL_STEPS - 1) handleNext();
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen} onKeyDown={handleKeyDown}>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}>
        Tutorial
        <IconButton size="xxs" variant="secondary" icon="close" onClick={onClose} />
      </DialogTitle>
      <DialogContent>
        <Box component="img" src={getTutorialImage(activeStep)} sx={{ width: '100%', borderRadius: 1, mb: 2, display: 'block' }} />
        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 0.5 }}>
          {STEP_TITLES[activeStep] ?? `Step ${activeStep + 1}`}
        </Typography>
        <Typography variant="body1" component="div">
          {activeStep < STEP_DESCRIPTIONS_STATIC.length ? (
            STEP_DESCRIPTIONS_STATIC[activeStep]
          ) : (
            <>
              This page is still in development. Please report any issues to <strong>Mac#4974</strong> on Discord. Feedback is always much
              appreciated!
              {examples && (
                <>
                  <Box sx={{ mt: 1.5, mb: 0.5 }}>Try the optimizer with an example setup — copy and paste into the import dialog:</Box>
                  <CopyableCode label="Random setup" code={examples.random} />
                  <CopyableCode label="Max setup" code={examples.max} />
                </>
              )}
            </>
          )}
        </Typography>
      </DialogContent>
      <MobileStepper
        variant="dots"
        steps={TOTAL_STEPS}
        position="static"
        activeStep={activeStep}
        sx={{ bgcolor: 'transparent', px: 2, pb: 2 }}
        backButton={<IconButton size="xxs" variant="secondary" icon="back" onClick={handleBack} disabled={activeStep === 0} />}
        nextButton={
          activeStep === TOTAL_STEPS - 1 ? (
            <IconButton size="xxs" icon="check" onClick={onClose} />
          ) : (
            <IconButton size="xxs" icon="next" onClick={handleNext} />
          )
        }
      />
    </Dialog>
  );
}
