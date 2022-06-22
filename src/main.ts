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
  const addPoint = (iPt:Vec3, rad:number) =>{
    // Create Tree node if not there
    if(!geomTreeItem){
      geomTreeItem = new TreeItem("Pts");
      scene.getRoot().addChild(geomTreeItem);
    }

    // Create Sphere, green
    let sPt = new Sphere(rad, 13)
    const ptGeomMaterial = new Material("ptGeomMaterial", "SimpleSurfaceShader");
    const color = ptGeomMaterial.getParameter("BaseColor")
    if( color)
      color.setValue(new Color(0, 1, 0));
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

  let useCOG = false
  let asmDiag = 0
  let asmCenter = new Vec3()
  let asmCog = new Vec3()
  let gXfos = new Map()
  let hasCOG: boolean = false
  
  const initExplodeData = () => {
    let parts=0
    const root = scene.getRoot()
    const rootBBox: Box3 = root.boundingBoxParam.value
    asmCenter = rootBBox.center()
    asmDiag = rootBBox.size()

    root.traverse((item) => {
      if (item instanceof InstanceItem || item instanceof CADPart) {
        const iBBox: Box3 = item.boundingBoxParam.value
        const iCenter = iBBox.center()
        
        let iCog = new Vec3
        if (useCOG) {
          const cogParam = item.getParameter('centerOfGravity')
          if (cogParam) {
            hasCOG = true
            iCog = cogParam.getValue()
            parts++
            asmCog.addInPlace(iCog)
          }
        }

        let igXfo: Xfo = item.globalXfoParam.value
        gXfos.set(item, {gXfo:igXfo, center:iCenter, cog:iCog} )
      }

    })
    let cogSacle= 0.001 /parts // mm to m
    asmCog.scaleInPlace(cogSacle)
    console.log('asmCog x='+asmCog.x+' y='+asmCog.y+' z'+asmCog.z )
    console.log('asmCenter x=' + asmCenter.x + ' y=' + asmCenter.y + ' z' + asmCenter.z + ' diag=' + asmDiag)
    
    // Visualize debug BBox
    let rad=asmDiag/100
    //addPoint(asmCenter, rad)
    //addPoint(rootBBox.p0, rad)
    //addPoint(rootBBox.p1, rad)
  }
  
  const applyAsmExplode = (asmExpansion: number) => {
    let iPart = 0
    scene.getRoot().traverse((item) => {
      if (item instanceof InstanceItem || item instanceof CADPart) { //InstanceItem CADPart
        const itemInfo = gXfos.get(item)
        let iCenter: Vec3 = itemInfo.center 
        let tr: Vec3 = iCenter.subtract(asmCenter).normalize()
        if(useCOG && hasCOG){
          let iCOG: Vec3 = itemInfo.cog 
          tr = asmCog.subtract(iCOG)
          console.log('===Using COG= tr x=' + tr.x + ' y=' + tr.y + ' z' + tr.z + '===')
        }
        let expans = asmDiag * asmExpansion / 1000
        tr.scaleInPlace(expans*expans )

        let igXfotr = new Xfo()
        igXfotr.setFromOther(itemInfo.gXfo)
        igXfotr.tr = itemInfo.gXfo.tr.add(tr)
        item.globalXfoParam.value = igXfotr


        if (iPart == 0) {
          console.log('==== tr x=' + tr.x + ' y=' + tr.y + ' z' + tr.z + '===')
          console.log('iXfotr.tr x=' + igXfotr.tr.x + ' y=' + igXfotr.tr.y + ' z' + igXfotr.tr.z)
        }
        iPart++
        //return false
      }
      //else
        //return true
    })
    renderer.frameAll()
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