/** Every family the host knows: element swaps (inputs) and global families (dialogs, tooltips, scrollbars). */
import type { ElementFamily, GlobalFamily } from '../host';
import { checkboxFamily, numberFamily, radioFamily, rangeFamily } from './basic';

export const ELEMENT_FAMILIES: ElementFamily[] = [checkboxFamily, radioFamily, rangeFamily, numberFamily];
export const GLOBAL_FAMILIES: GlobalFamily[] = [];
