import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/features/register.all.js';
import 'monaco-editor/languages/definitions/sql/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/editor/browser/coreCommands.js';
import 'monaco-editor/editor/contrib/caretOperations/browser/caretOperations.js';
import 'monaco-editor/editor/contrib/dropOrPasteInto/browser/copyPasteContribution.js';
import 'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands.js';
import 'monaco-editor/editor/contrib/gotoError/browser/markerSelectionStatus.js';
import 'monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/editor/common/standaloneStrings.js';

loader.config({ monaco });
