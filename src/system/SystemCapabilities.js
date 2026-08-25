// Internal capability descriptors let Agent tools share the application
// permission model without exposing a launchable desktop application.
export const systemTaskCapability={
  id:'tasks',title:'taskCenter',icon:'history',color:'blue',internal:true,
  mount(){},
};
