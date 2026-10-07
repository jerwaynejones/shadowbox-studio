/*******************************************************************************
* Author    :  Angus Johnson                                                   *
* Date      :  15 October 2022                                                 *
* Website   :  http://www.angusj.com                                           *
* Copyright :  Angus Johnson 2010-2022                                         *
* Purpose   :  Minkowski Sum and Difference                                    *
* License   :  http://www.boost.org/LICENSE_1_0.txt                            *
*******************************************************************************/
import { Path64, Paths64 } from "./core";
export declare class Minkowski {
    private static minkowskiInternal;
    static sum(pattern: Path64, path: Path64, isClosed: boolean): Paths64;
    static diff(pattern: Path64, path: Path64, isClosed: boolean): Paths64;
}
