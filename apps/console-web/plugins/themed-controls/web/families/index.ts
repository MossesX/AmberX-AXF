/** Every family the host knows: element swaps (inputs) and global families (dialogs, tooltips, scrollbars). */
import type { ElementFamily, GlobalFamily } from '../host';
import { checkboxFamily, radioFamily } from './basic';

export const ELEMENT_FAMILIES: ElementFamily[] = [checkboxFamily, radioFamily];
export const GLOBAL_FAMILIES: GlobalFamily[] = [];
