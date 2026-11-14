/** Every family the host knows: element swaps (inputs) and global families (dialogs, tooltips, scrollbars). */
import type { ElementFamily, GlobalFamily } from '../host';
import { checkboxFamily, numberFamily, radioFamily, rangeFamily } from './basic';
import { datetimeFamily } from './datetime';
import './time';
import { colorFamily } from './color';
import { dialogsFamily } from './dialogs';
import { fileFamily } from './file';
import { tooltipFamily } from './tooltip';

export const ELEMENT_FAMILIES: ElementFamily[] = [checkboxFamily, radioFamily, rangeFamily, numberFamily, datetimeFamily, colorFamily, fileFamily];
export const GLOBAL_FAMILIES: GlobalFamily[] = [dialogsFamily, tooltipFamily];
