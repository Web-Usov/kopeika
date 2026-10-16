import { terms } from '../../../shared/terms.ts';
import { lang } from '../i18n.ts';
import { LegalPage } from './Privacy.tsx';

export const Terms = () => <LegalPage doc={terms[lang]} />;
