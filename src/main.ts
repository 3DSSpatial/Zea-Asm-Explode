import {
  Color,
  Vec3,
  Xfo,
  Box3,
  Sphere,
  Material,
  Scene,
  GLRenderer,
  EnvMap,
  resourceLoader,
  AssetLoadContext,
  GeomItem,
  ObjAsset,
  Lines,
  LinesProxy,
  Mesh,
  MeshProxy,
  InstanceItem,
  CADAsset,
  CADBody,
  PMIItem,
  CompoundGeom,
  CADPart,
  TreeItem,
  StateChangedEvent,
  XRViewport,
} from '@zeainc/zea-engine'

import { SelectionManager } from '@zeainc/zea-ux'
import '@zeainc/zea-tree-view'
import { ZeaTreeView } from '@zeainc/zea-tree-view'
//@ts-ignore - No Types for the GLTF loader yet.
import { GLTFAsset } from '@zeainc/gltf-loader'
import { DropZone } from './drop-zone'
import { LoginDialog } from './login-dialog'
import './drop-zone'
import './login-dialog'

interface AppData {
  scene?: Scene
  renderer?: GLRenderer
  selectionManager?: SelectionManager
}

function init() {
  const urlParams = new URLSearchParams(window.location.search)
  const scene = new Scene()
  scene.setupGrid(10.0, 10)

  const xrMode = urlParams.has('xrMode') ? urlParams.get('xrMode') : 'AR'
  const renderer = new GLRenderer(<HTMLCanvasElement>document.getElementById('canvas'), {
    debugGeomIds: false,
    /* Enable frustum culling which speeds up rendering on large complex scenes */
    enableFrustumCulling: true,
    /* Enable Occlusion culling which speeds up rendering on large complex scenes */
    enableOcclusionCulling: true, 
    antialias: false ,
    xrMode: xrMode == 'AR' ? 'AR' : 'VR',
  })

  renderer.outlineThickness = 1.5
  renderer.outlineSensitivity = 5
  renderer.highlightOutlineThickness = 1.75
  renderer.outlineColor = new Color(0, 0, 0, 0.6)
  renderer.hiddenLineColor = new Color(0.2, 0.2, 0.2, 0.0)

  renderer.setScene(scene)
  renderer.getViewport().getCamera().setPositionAndTarget(new Vec3(2, 2, 2), new Vec3(0, 0, 0.5))

  const envMap = new EnvMap()
  envMap.load('./data/StudioG.zenv')
  scene.setEnvMap(envMap)

  const appData: AppData = {
    scene,
    renderer,
  }

  // Setup Selection Manager
  const selectionColor = new Color('#F9CE03')
  selectionColor.a = 0.1
  const selectionManager = new SelectionManager(appData, {
    selectionOutlineColor: selectionColor,
    branchSelectionOutlineColor: selectionColor,
  })
  appData.selectionManager = selectionManager
  // Setup Progress Bar
  const progressElement = <HTMLProgressElement>document.getElementById('progress')
  let hideId = 0
  resourceLoader.on('progressIncremented', (event) => {
    progressElement.value = event.percent
    if (event.percent >= 100) {
      // @ts-ignore
      hideId = setTimeout(() => progressElement.classList.add('hidden'), 1000)
    } else if (event.percent < 100) {
      if (hideId) {
        clearTimeout(hideId)
        hideId = 0
      }
      progressElement.classList.remove('hidden')
    }
  })

  // Setup FPS Display
  const fpsElement = document.getElementById('fps')
  if (fpsElement) {
    let frameCounter = 0
    renderer.on('redrawOccurred', () => {
      frameCounter++
    })
    setInterval(() => {
      fpsElement.textContent = `Fps: ${frameCounter * 2}`
      frameCounter = 0
    }, 500)
  }

  // Setup TreeView Display
  const $tree = <ZeaTreeView>document.querySelector('#tree')
  $tree.setSelectionManager(selectionManager)
  $tree.setTreeItem(scene.getRoot())

  // let highlightedItem
  const highlightColor = new Color('#F9CE03')
  highlightColor.a = 0.1
  const filterItem = (srcItem: TreeItem) => {
    let item: TreeItem = srcItem
    while (item && !(item instanceof CADBody) && !(item instanceof PMIItem)) {
      item = <TreeItem>item.getOwner()
    }
    if (!item) return srcItem
    if (item.getOwner() instanceof InstanceItem) {
      item = <TreeItem>item.getOwner()
    }
    return item
  }
  renderer.getViewport().on('pointerDown', (event) => {
    if (event.intersectionData) {
      const geomItem = filterItem(event.intersectionData.geomItem)
      if (geomItem) {
        console.log(geomItem.getPath())
      }
    }
  })

  renderer.getViewport().on('pointerUp', (event) => {
    // Detect a right click
    if (event.button == 0) {
      if (event.intersectionData) {
        // // if the selection tool is active then do nothing, as it will
        // // handle single click selection.s
        // const toolStack = toolManager.toolStack
        // if (toolStack[toolStack.length - 1] == selectionTool) return

        // To provide a simple selection when the SelectionTool is not activated,
        // we toggle selection on the item that is selcted.
        const item = filterItem(event.intersectionData.geomItem)
        if (item) {
          if (!event.shiftKey) {
            selectionManager.toggleItemSelection(item, !event.ctrlKey)
          } else {
            const items = new Set<TreeItem>()
            items.add(item)
            selectionManager.deselectItems(items)
          }
        }
      } else {
        selectionManager.clearSelection()
      }
    }
  })

  document.addEventListener('keydown', (event) => {
    if (event.key == 'f') {
      renderer.frameAll()
      event.stopPropagation()
    }
  })


  renderer.getXRViewport().then((xrvp: XRViewport) => {
    if (fpsElement) fpsElement.style.bottom = '70px'

    const xrButton = document.getElementById('xr-button')
    if (xrButton) {
      xrButton.textContent = 'Launch ' + xrMode
      xrButton.classList.remove('hidden')

      xrvp.on('presentingChanged', (event: StateChangedEvent) => {
        const { state } = event
        if (state) {
          xrButton.textContent = 'Exit ' + xrMode
        } else {
          xrButton.textContent = 'Launch ' + xrMode
        }
      })

      xrButton.addEventListener('click', () => {
        xrvp.togglePresenting()
      })
    }

    document.addEventListener('keydown', (event) => {
      if (event.key == ' ') {
        xrvp.togglePresenting()
      }
    })
  
  })

  if (urlParams.has('profile')) {
    renderer.startContinuousDrawing()
  }

  // ////////////////////////////////////////////
  // Create debug point
  let geomTreeItem: TreeItem;
  const addPoint = (iPt:Vec3, iRadius:number, iColor:Color) =>{
    // Create Tree node if not there
    if(!geomTreeItem){
      geomTreeItem = new TreeItem("Pts");
      scene.getRoot().addChild(geomTreeItem);
    }

    // Create Sphere, green
    let sPt = new Sphere(iRadius, 4)
    const ptGeomMaterial = new Material("ptGeomMaterial", "SimpleSurfaceShader");
    const color = ptGeomMaterial.getParameter("BaseColor")
    if( color)
      color.setValue(iColor);
    const geomItem = new GeomItem("iPt", sPt , ptGeomMaterial);
  
    // Sphere position
    const targXfo = new Xfo();
    targXfo.tr= iPt
    geomItem.localXfoParam.value=targXfo;

    geomTreeItem.addChild(geomItem);
  }

  // ////////////////////////////////////////////
  // Assembly Explode

  let asmExpansion = 0
  const asmSlider = <HTMLInputElement>document.getElementById('asmSlider')
  if (asmSlider) {
    asmSlider.addEventListener('input', function () {
      asmExpansion = this.valueAsNumber
      //console.log('asmSlider pos=', asmExpansion)
      applyAsmExplode(asmExpansion)
    })
  }

  const debugPoints = false
  let asmDiag = 0
  let asmXfo = new Xfo()
  let asmCenter = new Vec3()
  let asmBBox = new Box3()
  let itemsInfo = new Map()

  const applyAsmExplode = (asmExpansion: number) => {
    scene.getRoot().traverse((item) => {
      if (item instanceof CADPart) { 
        if(item.getName()=='M10X25g') return
        const itemInfo = itemsInfo.get(item)
        let iCenter: Vec3 = itemInfo.center 
        let tr: Vec3 = iCenter.subtract(asmCenter) //.normalize()
        tr = asmXfo.transformVec3(tr)
        // Using expans^2 so it moves slower when close
        let expans =  asmExpansion 
        tr.scaleInPlace(expans * expans / 100000 ) // 10 / (1000 * 1000)

        let igXfotr = new Xfo()
        igXfotr.setFromOther(itemInfo.gXfo)
        igXfotr.tr = itemInfo.gXfo.tr.add(tr)
        item.globalXfoParam.value = igXfotr
      }
    })
    //renderer.frameAll()
  }
  

  const initExplodeData = () => {
    let p0 = new Vec3()
    let p1 = new Vec3()
    const root = scene.getRoot()
    const rootBBox: Box3 = root.boundingBoxParam.value
    let rootCenter = rootBBox.center()
    asmDiag = rootBBox.size()
    asmXfo.sc = rootBBox.diagonal()
    let minDist =  Number.MAX_SAFE_INTEGER
    root.traverse((item) => {
      if (item instanceof CADPart) {
        if(item.getName()=='M10X25g') return // hack for JYJ2#1460T***.zcad
        const iBBox: Box3 = item.boundingBoxParam.value
        const iCenter = iBBox.center()
         // recomputing asmBBox since rootBBox sometimes has pb (see M10X25g in JYJ2#1460T***.zcad )
        asmBBox.addPoint(iCenter)
        let dist =  iCenter.distanceTo(rootCenter)
        if(dist < minDist ){
          minDist = dist
          asmCenter = iCenter
          p0 = iBBox.p0
          p1 = iBBox.p1
        }
        let igXfo: Xfo = item.globalXfoParam.value
        itemsInfo.set(item, {gXfo:igXfo, center:iCenter} )
      }
    })
    asmXfo.sc = asmBBox.diagonal().normalize()
    if(asmXfo.sc.x>0.8) asmXfo.sc.x = 0.1 // for parts mostly cylindrical
    if(asmXfo.sc.y>0.8) asmXfo.sc.y = 0.1
    if(asmXfo.sc.z>0.8) asmXfo.sc.z = 0.1
    //console.log('asmXfo.sc x=' + asmXfo.sc.x + ' y=' + asmXfo.sc.y + ' z=' + asmXfo.sc.z + ' diag=' + asmDiag)
    //console.log('asmCenter x=' + asmCenter.x + ' y=' + asmCenter.y + ' z=' + asmCenter.z + ' diag=' + asmDiag+ ' parts=' + parts)
    
    // Visualize debug BBox
    if (debugPoints) {
      let rad = asmDiag / 100
      let green = new Color(0, 1, 0)
      addPoint(asmBBox.center(), rad, green)
      addPoint(asmBBox.p0, rad, green)
      addPoint(asmBBox.p1, rad, green)
      let blue = new Color(0, 0, 1)
      addPoint(asmCenter, rad, blue)
      addPoint(p0, rad, blue)
      addPoint(p1, rad, blue)
    }
  }
  

  // ////////////////////////////////////////////
  // Load the asset
  const calcSceneComplexity = () => {
    let parts = 0
    let geomItems = 0
    let triangles = 0
    let lines = 0
    scene.getRoot().traverse((item) => {
      if (item instanceof CADPart) {
        parts++
      } else if (item instanceof GeomItem) {
        geomItems++
        const geom = item.geomParam.value
        if (geom instanceof Lines) {
          lines += geom.getNumSegments()
        } else if (geom instanceof LinesProxy) {
          lines += geom.getNumLineSegments()
        } else if (geom instanceof Mesh) {
          triangles += geom.computeNumTriangles()
        } else if (geom instanceof MeshProxy) {
          triangles += geom.getNumTriangles()
        } else if (geom instanceof CompoundGeom) {
          lines += geom.getNumLineSegments()
          triangles += geom.getNumTriangles()
        }
      }
    })
    console.log(`parts:${parts} geomItems:${geomItems} lines:${lines} triangles:${triangles}`)
  }
  const loadCADAsset = (zcad: string) => {
    // Note: leave the asset name empty so that the asset
    // gets the name of the product in the file.
    const asset = new CADAsset()

    const context = new AssetLoadContext()
    // pass the camera in wth the AssetLoadContext so that
    // PMI classes can bind to it.
    context.camera = renderer.getViewport().getCamera()
    asset.load(zcad, context).then(() => {
      renderer.frameAll()
    })
    asset.getGeometryLibrary().on('loaded', () => {
      console.log('Geometry Loaded.')
      calcSceneComplexity()
      initExplodeData()
    })
    if (urlParams.has('ytoz')) {
      const xfo = new Xfo()
      xfo.ori.setFromAxisAndAngle(new Vec3(1, 0, 0), Math.PI * 0.5)
      asset.globalXfoParam.value = xfo
    }
    scene.getRoot().addChild(asset)
  }

  const loadGLTFAsset = (url: string, filename: string = '') => {
    const asset = new GLTFAsset(filename)
    asset.load(url, filename).then(() => {
      calcSceneComplexity()
      renderer.frameAll()
    })
    scene.getRoot().addChild(asset)
    return asset
  }

  const loadOBJAsset = (url: string, filename: string = '') => {
    const asset = new ObjAsset(filename)
    asset.load(url).then(() => {
      calcSceneComplexity()
      renderer.frameAll()
    })
    scene.getRoot().addChild(asset)
    return asset
  }

  const loadAsset = (url: string, filename: string = '') => {
    if (filename.endsWith('zcad')) {
      return loadCADAsset(url)
    } else if (filename.endsWith('gltf') || filename.endsWith('glb')) {
      return loadGLTFAsset(url, filename)
    } else if (filename.endsWith('obj')) {
      return loadOBJAsset(url, filename)
    } else {
      throw new Error('Unsupported file type:' + filename)
    }
  }

  if (urlParams.has('zcad')) {
    loadCADAsset(urlParams.get('zcad')!)
  } else if (urlParams.has('gltf')) {
    loadGLTFAsset(urlParams.get('gltf')!)
  } else if (urlParams.has('obj')) {
    loadOBJAsset(urlParams.get('obj')!)
  } else {
    const dropZone = <DropZone>document.getElementById('dropZone')
    dropZone.display((url, filename) => {
      loadAsset(url, filename)
    })
  }

  // const xfo = new Xfo();
  // xfo.ori.setFromEulerAngles(new EulerAngles(90 * (Math.PI / 180), 0, 0));
  // asset.getParameter("GlobalXfo").setValue(xfo);
}
// To enable simple authentication in this app
// change this value to true.
if (false) {
  // Show the login page.
  const login = <LoginDialog>document.getElementById('login')
  login.show(() => {
    // When it is closed, init the scene.
    init()
  })
} else {
  init()
}
