/*******************************************************************************
* Author    :  Angus Johnson                                                   *
* Date      :  3 September 2023                                                  *
* Website   :  http://www.angusj.com                                           *
* Copyright :  Angus Johnson 2010-2023                                         *
* Purpose   :  This is the main polygon clipping module                        *
* Thanks    :  Special thanks to Thong Nguyen, Guus Kuiper, Phil Stopford,     *
*           :  and Daniel Gosnell for their invaluable assistance with C#.     *
* License   :  http://www.boost.org/LICENSE_1_0.txt                            *
*******************************************************************************/
import { ClipType, FillRule, IPoint64, Path64, PathType, Paths64, Rect64 } from "./core";
export declare enum PointInPolygonResult {
    IsOn = 0,
    IsInside = 1,
    IsOutside = 2
}
export declare enum VertexFlags {
    None = 0,
    OpenStart = 1,
    OpenEnd = 2,
    LocalMax = 4,
    LocalMin = 8
}
declare class Vertex {
    readonly pt: IPoint64;
    next: Vertex | undefined;
    prev: Vertex | undefined;
    flags: VertexFlags;
    constructor(pt: IPoint64, flags: VertexFlags, prev: Vertex | undefined);
}
declare class LocalMinima {
    readonly vertex: Vertex;
    readonly polytype: PathType;
    readonly isOpen: boolean;
    constructor(vertex: Vertex, polytype: PathType, isOpen?: boolean);
    static equals(lm1: LocalMinima, lm2: LocalMinima): boolean;
    static notEquals(lm1: LocalMinima, lm2: LocalMinima): boolean;
}
declare class OutPt {
    pt: IPoint64;
    next: OutPt | undefined;
    prev: OutPt;
    outrec: OutRec;
    horz: HorzSegment | undefined;
    constructor(pt: IPoint64, outrec: OutRec);
}
export declare enum JoinWith {
    None = 0,
    Left = 1,
    Right = 2
}
export declare enum HorzPosition {
    Bottom = 0,
    Middle = 1,
    Top = 2
}
export declare class OutRec {
    idx: number;
    owner: OutRec | undefined;
    frontEdge: Active | undefined;
    backEdge: Active | undefined;
    pts: OutPt | undefined;
    polypath: PolyPathBase | undefined;
    bounds: Rect64;
    path: Path64;
    isOpen: boolean;
    splits: number[] | undefined;
    recursiveSplit: OutRec | undefined;
    constructor(idx: number);
}
declare class HorzSegment {
    leftOp: OutPt;
    rightOp: OutPt | undefined;
    leftToRight: boolean;
    constructor(op: OutPt);
}
export declare class Active {
    bot: IPoint64;
    top: IPoint64;
    curX: number;
    dx: number;
    windDx: number;
    windCount: number;
    windCount2: number;
    outrec: OutRec | undefined;
    prevInAEL: Active | undefined;
    nextInAEL: Active | undefined;
    prevInSEL: Active | undefined;
    nextInSEL: Active | undefined;
    jump: Active | undefined;
    vertexTop: Vertex | undefined;
    localMin: LocalMinima;
    isLeftBound: boolean;
    joinWith: JoinWith;
    constructor();
}
export declare class ClipperEngine {
    static addLocMin(vert: Vertex, polytype: PathType, isOpen: boolean, minimaList: LocalMinima[]): void;
    static addPathsToVertexList(paths: Path64[], polytype: PathType, isOpen: boolean, minimaList: LocalMinima[], vertexList: Vertex[]): void;
}
export declare class ReuseableDataContainer64 {
    readonly _minimaList: LocalMinima[];
    private readonly _vertexList;
    constructor();
    clear(): void;
    addPaths(paths: Paths64, pt: PathType, isOpen: boolean): void;
}
export declare class ClipperBase {
    private _cliptype;
    private _fillrule;
    private _actives?;
    private _sel?;
    private readonly _minimaList;
    private readonly _intersectList;
    private readonly _vertexList;
    private readonly _outrecList;
    private readonly _scanlineList;
    private readonly _horzSegList;
    private readonly _horzJoinList;
    private _currentLocMin;
    private _currentBotY;
    private _isSortedMinimaList;
    private _hasOpenPaths;
    protected _using_polytree: boolean;
    protected _succeeded: boolean;
    preserveCollinear: boolean;
    reverseSolution: boolean;
    constructor();
    private static isOdd;
    private static isHotEdgeActive;
    private static isOpen;
    private static isOpenEndActive;
    private static isOpenEnd;
    private static getPrevHotEdge;
    private static isFront;
    /*******************************************************************************
    *  Dx:                             0(90deg)                                    *
    *                                  |                                           *
    *               +inf (180deg) <--- o --. -inf (0deg)                          *
    *******************************************************************************/
    private static getDx;
    private static topX;
    private static isHorizontal;
    private static isHeadingRightHorz;
    private static isHeadingLeftHorz;
    private static swapActives;
    private static getPolyType;
    private static isSamePolyType;
    private static setDx;
    private static nextVertex;
    private static prevPrevVertex;
    private static isMaxima;
    private static isMaximaActive;
    private static getMaximaPair;
    private static getCurrYMaximaVertex_Open;
    private static getCurrYMaximaVertex;
    private static setSides;
    private static swapOutrecs;
    private static setOwner;
    private static area;
    private static areaTriangle;
    private static getRealOutRec;
    private static isValidOwner;
    private static uncoupleOutRec;
    private static outrecIsAscending;
    private static swapFrontBackSides;
    private static edgesAdjacentInAEL;
    protected clearSolutionOnly(): void;
    clear(): void;
    protected reset(): void;
    private insertScanline;
    private popScanline;
    private hasLocMinAtY;
    private popLocalMinima;
    private addLocMin;
    addSubject(path: Path64): void;
    addOpenSubject(path: Path64): void;
    addClip(path: Path64): void;
    protected addPath(path: Path64, polytype: PathType, isOpen?: boolean): void;
    protected addPaths(paths: Paths64, polytype: PathType, isOpen?: boolean): void;
    protected addReuseableData(reuseableData: ReuseableDataContainer64): void;
    private isContributingClosed;
    private isContributingOpen;
    private setWindCountForClosedPathEdge;
    private setWindCountForOpenPathEdge;
    private static isValidAelOrder;
    private insertLeftEdge;
    private static insertRightEdge;
    private insertLocalMinimaIntoAEL;
    private pushHorz;
    private popHorz;
    private addLocalMinPoly;
    private addLocalMaxPoly;
    private static joinOutrecPaths;
    private static addOutPt;
    private newOutRec;
    private startOpenPath;
    private updateEdgeIntoAEL;
    private static findEdgeWithMatchingLocMin;
    private intersectEdges;
    private deleteFromAEL;
    private adjustCurrXAndCopyToSEL;
    protected executeInternal(ct: ClipType, fillRule: FillRule): void;
    private doIntersections;
    private disposeIntersectNodes;
    private addNewIntersectNode;
    private static extractFromSEL;
    private static insert1Before2InSEL;
    private buildIntersectList;
    private processIntersectList;
    private swapPositionsInAEL;
    private static resetHorzDirection;
    private static horzIsSpike;
    private static trimHorz;
    private addToHorzSegList;
    private getLastOp;
    /*******************************************************************************
    * Notes: Horizontal edges (HEs) at scanline intersections (i.e. at the top or    *
    * bottom of a scanbeam) are processed as if layered.The order in which HEs     *
    * are processed doesn't matter. HEs intersect with the bottom vertices of      *
    * other HEs[#] and with non-horizontal edges [*]. Once these intersections     *
    * are completed, intermediate HEs are 'promoted' to the next edge in their     *
    * bounds, and they in turn may be intersected[%] by other HEs.                 *
    *                                                                              *
    * eg: 3 horizontals at a scanline:    /   |                     /           /  *
    *              |                     /    |     (HE3)o ========%========== o   *
    *              o ======= o(HE2)     /     |         /         /                *
    *          o ============#=========*======*========#=========o (HE1)           *
    *         /              |        /       |       /                            *
    *******************************************************************************/
    private doHorizontal;
    private doTopOfScanbeam;
    private doMaxima;
    private static isJoined;
    private split;
    private checkJoinLeft;
    private checkJoinRight;
    private static fixOutRecPts;
    private static setHorzSegHeadingForward;
    private static updateHorzSegment;
    private static duplicateOp;
    private convertHorzSegsToJoins;
    private static getCleanPath;
    private static pointInOpPolygon;
    private static path1InsidePath2;
    private moveSplits;
    private processHorzJoins;
    private static ptsReallyClose;
    private static isVerySmallTriangle;
    private static isValidClosedPath;
    private static disposeOutPt;
    private cleanCollinear;
    private doSplitOp;
    private fixSelfIntersects;
    static buildPath(op: OutPt | undefined, reverse: boolean, isOpen: boolean, path: Path64): boolean;
    protected buildPaths(solutionClosed: Paths64, solutionOpen: Paths64): boolean;
    private static getBoundsPath;
    private checkBounds;
    private checkSplitOwner;
    private recursiveCheckOwners;
    protected buildTree(polytree: PolyPathBase, solutionOpen: Paths64): void;
    getBounds(): Rect64;
}
export declare class Clipper64 extends ClipperBase {
    addPath(path: Path64, polytype: PathType, isOpen?: boolean): void;
    addReusableData(reusableData: ReuseableDataContainer64): void;
    addPaths(paths: Paths64, polytype: PathType, isOpen?: boolean): void;
    addSubjectPaths(paths: Paths64): void;
    addOpenSubjectPaths(paths: Paths64): void;
    addClipPaths(paths: Paths64): void;
    execute(clipType: ClipType, fillRule: FillRule, solutionClosed: Paths64, solutionOpen?: Paths64): boolean;
    executePolyTree(clipType: ClipType, fillRule: FillRule, polytree: PolyTree64, openPaths?: Paths64): boolean;
}
export declare abstract class PolyPathBase {
    protected _parent?: PolyPathBase;
    children: Array<PolyPathBase>;
    polygon?: Path64;
    get isHole(): boolean;
    constructor(parent?: PolyPathBase);
    private getLevel;
    get level(): number;
    private getIsHole;
    get count(): number;
    abstract addChild(p: Path64): PolyPathBase;
    clear(): void;
    forEach: (callbackfn: (value: PolyPathBase, index: number, array: PolyPathBase[]) => void, thisArg?: any) => void;
    private toStringInternal;
    toString(): string;
}
export declare class PolyPath64 extends PolyPathBase {
    constructor(parent?: PolyPathBase);
    addChild(p: Path64): PolyPathBase;
    get(index: number): PolyPath64;
    child(index: number): PolyPath64;
    area(): number;
}
export declare class PolyTree64 extends PolyPath64 {
}
export declare class ClipperLibException extends Error {
    constructor(description: string);
}
export {};
